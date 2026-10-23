---
title: "C 语言位操作：嵌入式寄存器读写的正确姿势"
description: "置位、清零、翻转、取字段——寄存器操作四件套，以及 1<<31、有符号右移、忘写 ~ 这些经典坑"
pubDate: 2026-10-23
tags: ["C语言", "位操作", "寄存器", "STM32", "基础"]
platform: "通用"
category: "工具"
difficulty: "入门"
---

嵌入式里跟寄存器打交道，本质就是位操作。看起来简单，但每年都有人的 `GPIOA->ODR` 被写得面目全非。这篇把四件套和五个经典坑一次讲清。

## 四个基本动作

假设要让 `REG` 的第 3 位置 1：

```c
#define BIT(n)  (1UL << (n))

REG |= BIT(3);        // 置位：其他位不动
REG &= ~BIT(3);       // 清零
REG ^= BIT(3);        // 翻转
if (REG & BIT(3)) {}  // 判断
```

四个动作的语义各不相同，别混：

| 动作 | 写法 | 说明 |
|---|---|---|
| 置 1 | `x \|= mask` | 或运算，必然置 1 |
| 清 0 | `x &= ~mask` | 与上掩码取反，**`~` 不能漏** |
| 翻转 | `x ^= mask` | 异或 1 翻转，异或 0 不变 |
| 读 | `x & mask` | 结果非 0 即为 1 |

## 坑一：漏掉 `~`

```c
REG &= BIT(3);    // ❌ 错！这不是清零
```

`REG &= BIT(3)` 的意思是「只保留第 3 位，其他全清 0」。本想清一位，结果把整个寄存器洗了。

正确写法必须取反：`REG &= ~BIT(3);`

**记忆法**：清零要「反着来」。凡是 `&=`，右边必然带 `~`。

## 坑二：`1 << 31`

```c
unsigned int x = 1 << 31;   // ⚠️ 未定义行为
```

`1` 是 `int`，而有符号整数左移到符号位是 **未定义行为**，编译器有权「优化」成任何结果。

```c
#define BIT(n)  (1UL << (n))    // ✅ 用无符号
```

`1UL` 是 `unsigned long`（32 位平台上至少 32 位），左移 31 位是合法的。

同理，32 位以上的掩码要用 `1ULL`。

## 坑三：有符号数的右移

```c
int  a = -8;
int  b = a >> 1;    // 可能是 -4，也可能是 -3（实现定义）
```

C 标准对**负数右移**是实现定义：算术右移（补符号位，得 -4）或逻辑右移（补 0，得巨大正数）都合法。

- 要算术右移，用有符号类型，并且别指望跨编译器一致
- 要逻辑右移，**先转无符号**：

```c
unsigned int logical = ((unsigned int)a) >> 1;
```

## 坑四：多比特字段要「先清后写」

要往第 4~6 位（3 位宽）写入值 5：

```c
#define FIELD_MASK   (0x7UL << 4)     // 0b111 << 4
#define FIELD_WIDTH  3

// ❌ 错：直接或进去，原来的值还在
REG |= (5 << 4);

// ✅ 对：先清掉这一段，再写入
REG = (REG & ~FIELD_MASK) | ((5UL << 4) & FIELD_MASK);
```

为什么最后还要 `& FIELD_MASK`？**防止写入值超宽**。如果传进来的是 9（`0b1001`，4 位），不做掩码会溢出到第 7 位，污染相邻字段。

封装成宏：

```c
#define FIELD_SET(reg, mask, shift, val) \
    ((reg) = ((reg) & ~(mask)) | (((val) << (shift)) & (mask)))

#define FIELD_GET(reg, mask, shift) \
    (((reg) & (mask)) >> (shift))
```

用的时候：

```c
FIELD_SET(GPIOA->CRL, 0x7UL << 4, 4, 5);   // 写 5
uint32_t v = FIELD_GET(GPIOA->CRL, 0x7UL << 4, 4);
```

## 坑五：`volatile` 与位操作配合

这是最隐蔽的。硬件寄存器的值可能被外设改变，操作时必须让编译器每次都真读内存：

```c
#define GPIOA_ODR  (*(volatile uint32_t *)0x4001080C)

GPIOA_ODR |= BIT(5);    // ✅ volatile 指针解引用，读-改-写
```

注意 `|=` 本身是三步：**读 → 或 → 写**。在单核、且没有别人同时改这个寄存器时没问题。但如果：

- 你在中断里和主循环里都改同一个寄存器
- 或者这个寄存器是 32 位读/写分离的（有些外设要求分开）

那就不能直接 `|=`，得用「原子置位寄存器」（很多 MCU 提供 `BSRR` / `GPIOx->BSRR` 这类硬件原子操作）：

```c
// STM32 的 BSRR：写 1 到低 16 位置位，写 1 到高 16 位清零
GPIOA->BSRR = (1UL << 5);           // 置位 PA5，单次写入，无读-改-写
GPIOA->BSRR = (1UL << (5 + 16));    // 清零 PA5
```

**能用硬件原子寄存器就别用 `|=`**，尤其在中断里。

## 一个完整的例子

STM32 上配置 PA5 为推挽输出、50MHz：

```c
#include <stdint.h>

#define PERIPH_BASE     0x40000000UL
#define GPIOA_BASE      (PERIPH_BASE + 0x10800UL)

typedef struct {
    volatile uint32_t CRL;    // 0x00 低 8 位配置
    volatile uint32_t CRH;    // 0x04 高 8 位配置
    volatile uint32_t IDR;    // 0x08 输入数据
    volatile uint32_t ODR;    // 0x0C 输出数据
    volatile uint32_t BSRR;   // 0x10 位设置/清除
    volatile uint32_t BRR;    // 0x14 位清除
    volatile uint32_t LCKR;   // 0x18 配置锁定
} GPIO_TypeDef;

#define GPIOA   ((GPIO_TypeDef *)GPIOA_BASE)

void pa5_init(void)
{
    /* PA5 在 CRL 的第 20~23 位：MODE5[1:0] = 11 (50MHz), CNF5[1:0] = 00 (推挽输出) */
    uint32_t tmp = GPIOA->CRL;
    tmp &= ~(0xFUL << 20);          // 清掉这 4 位
    tmp |=  (0x3UL << 20);          // 0011 = 输出模式 + 50MHz
    GPIOA->CRL = tmp;
}

void pa5_set(int on)
{
    if (on) GPIOA->BSRR = (1UL << 5);
    else    GPIOA->BSRR = (1UL << (5 + 16));
}
```

几个细节值得注意：

- `CRL` 声明成 `volatile uint32_t`，编译器不会把它缓存到寄存器里
- 修改 `CRL` 时先读到临时变量再整体写回，避免多次读寄存器
- 用 `BSRR` 代替 `ODR |=`，单次写入、天然原子

## 小结

| 要点 | 记住这句 |
|---|---|
| 清零 | `&=` 右边必带 `~`，否则会把别的位洗掉 |
| 移位数 | 用 `1UL` / `1ULL`，别用裸 `1` |
| 右移 | 有符号右移是实现定义，要逻辑右移先转无符号 |
| 多比特 | 先清掩码再写，写入值也要 `& mask` 兜底 |
| 并发 | 能用 `BSRR` 就别用 `\|=`，读-改-写不是原子的 |

位操作本身不难，难的是**每一位都写对**。工程里更推荐把寄存器操作封成 `FIELD_SET` / `FIELD_GET` 宏，让「掩码和移位」只在一个地方定义，改硬件时不用满世界找魔法数字。
