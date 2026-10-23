---
title: "volatile / const / static：三个关键字，三种完全不同的语义"
description: "volatile 治的不是「优化」，是「编译器不知道有人在背后改内存」；const 四种写法、static 三种作用域，一次理顺"
pubDate: 2026-10-23
tags: ["C语言", "volatile", "const", "static", "编译器"]
platform: "通用"
category: "工具"
difficulty: "进阶"
---

这三个关键字几乎每份嵌入式代码里都出现，但真正说得清的人不多。它们解决的是**三个互不相干的问题**：`volatile` 管可见性，`const` 管可写性，`static` 管链接与生命周期。

## volatile：告诉编译器「这块内存会自己变」

### 它到底解决什么问题

编译器优化的前提假设是：**同一块内存，只要我没写过，值就不该变**。于是它会做这类优化：

```c
int flag = 0;

while (!flag) {
    /* 等待 */
}
```

开了 `-O2` 之后，编译器发现循环体里没人改 `flag`，就把判断提到循环外面，变成「如果 flag 一开始是 0，就死循环」。这在**中断会改 flag** 的场景下是致命错误——中断把内存改了，但 CPU 读的是寄存器缓存。

加上 `volatile`：

```c
volatile int flag = 0;
```

编译器就不敢缓存，每次循环都重新从内存读。

### 什么时候必须加

| 场景 | 例子 |
|---|---|
| 硬件寄存器 | `*(volatile uint32_t *)0x4001080C` |
| 中断与主循环共享的变量 | `volatile uint8_t rx_flag` |
| DMA 缓冲区 | 外设在背后写内存，CPU 不知道 |
| 内存映射 I/O | 读一次就有副作用（如清标志位） |

### 什么时候不加

`volatile` **不是**「为了安全加上总没坏处」。它会让编译器放弃一批优化：

```c
volatile int i;
for (i = 0; i < 1000000; i++) { ... }
```

这个循环的计数变量被 `volatile` 之后，每次自增都要真读写内存，性能可能慢好几倍。**普通局部变量、函数参数、纯计算中间结果，都不该加。**

### 最大的误解：volatile ≠ 原子

```c
volatile uint32_t counter;

counter++;      // ❌ 不是原子操作
```

`counter++` 实际是三步：读 → 加 → 写。两条并发的执行流（中断 / 多核 / RTOS 任务）交错时，仍然会丢更新。

要原子性，得用：

- 关中断（单核）
- `__disable_irq()` / `__enable_irq()` 包围临界区
- 或硬件原子指令：LDREX/STREX、`__atomic_fetch_add`
- 或干脆只让一个上下文写（单生产者）

**`volatile` 保证的是「每次都读内存」，不是「读和写不会被打断」。**

## const：不只是「常量」

`const` 的实际含义是「**通过这个名字不能修改**」，它能修饰指针本身，也能修饰指针指向的东西。

```c
const char *p;              // 指向的内容不可改，p 本身可改
char * const p;             // p 不可改，指向的内容可改
const char * const p;       // 两者都不可改
char const *p;              // 等价于 const char *p（写法顺序无关）
```

**读法**：从变量名开始，往右读，遇到 `*` 就回头向左读。

```c
const char * const p;
// p 是 const 的指针 → 指向 const char
```

### 在函数参数上的实际意义

```c
void uart_send(const uint8_t *buf, size_t len);
```

这句话向调用者承诺：**这个函数不会改你的缓冲区**。同时编译器能据此做优化（知道 `buf` 不会被写，可以只读一次）。

嵌入式里大量接收/发送接口都该这么写。漏了 `const`，调用者就得提心吊胆地检查实现。

### const 与 ROM

```c
const uint8_t logo[] = { 0x00, 0x18, 0x3C, ... };
```

在大多数交叉工具链里，`const` 的全局数组会被放进 `.rodata`，最终落到 **Flash** 而不是 RAM。一张 1KB 的图放 Flash 还是放 RAM，对小容量 MCU 差别很大。

想确认的话，看 map 文件里的段分配：

```text
.rodata   0x08001234   0x400   （在 FLASH 区）
.data     0x20000000   0x20    （在 RAM 区，且初始化值要从 Flash 拷贝过来）
.bss      0x20000020   0x100   （在 RAM 区，启动时清零）
```

## static：三种完全不同的作用

初学者最容易混的就是 `static`——它在不同位置含义完全不同。

### 1. 文件作用域：内部链接

```c
// uart.c
static void uart_isr(void) { ... }   // 只有本文件能调用
static int  rx_count = 0;            // 只有本文件能访问
```

作用：**把符号藏起来**，别的 `.c` 文件 `extern` 不到。这是 C 里实现「私有」的唯二手段（另一个是匿名结构体 / 不导出）。

工程意义很大：多个模块都有 `init()`、`send()` 这类同名函数时，不加 `static` 会在链接期报重复符号。

### 2. 函数内部：生命周期延长到整个程序

```c
void tick(void)
{
    static uint32_t count = 0;    // 只初始化一次
    count++;
    printf("%lu\n", count);
}
```

- 存放在 `.data` / `.bss`（不在栈上）
- 初始化只做一次（C 标准保证）
- 函数返回后值保留

嵌入式里常用来做「只在第一次调用时初始化」：

```c
void sensor_read(void)
{
    static int inited = 0;
    if (!inited) {
        sensor_hw_init();
        inited = 1;
    }
    /* ... */
}
```

**注意**：函数内 `static` 变量**不是线程安全的**。在 RTOS 里多个任务调同一个函数，会共享这个变量。

### 3. 为什么 `static` 局部变量要小心

```c
uint32_t next_id(void)
{
    static uint32_t id = 0;
    return ++id;
}
```

这种写法在单任务里很优雅，但：

- 无法重入（递归调用会互相干扰）
- 单元测试里状态会残留（测试之间不隔离）
- 多任务下需要加锁

能用「传上下文指针」的场合，优先用上下文，别用 `static` 藏状态。

## 三个关键字一起看

```c
static volatile uint32_t g_tick;              // 文件内可见 + 每次真读 + 可写
static const uint8_t  crc_table[256];         // 文件内可见 + 只读（进 Flash）
void parse(const volatile uint8_t *buf);      // 承诺不改 buf 内容，但每字节都真读
```

最后那行有点极端，但语义清晰：`const` 修饰的是「指向的内容」，`volatile` 也修饰内容——两者可以共存，表示「我不改它，但它可能自己变」（比如状态寄存器）。

## 一份速查表

| 关键字 | 解决的问题 | 加错/漏加的后果 |
|---|---|---|
| `volatile` | 编译器缓存了可能被外部改的内存 | 死循环、读到过期值、ISR 标志丢失 |
| `const` | 承诺不修改 + 允许放 Flash | 接口含糊，调用者要读实现才能确认 |
| `static`（文件级） | 符号可见性 | 链接冲突「multiple definition」 |
| `static`（函数内） | 变量生命周期 | 状态残留、不可重入、多任务不安全 |

## 一个真实 bug 复盘

早期写串口接收，代码长这样：

```c
uint8_t rx_buf[64];
uint16_t rx_len = 0;

void USART1_IRQHandler(void)
{
    rx_buf[rx_len++] = USART1->DR;
}

int main(void)
{
    while (1) {
        if (rx_len > 0) {          // ❌ rx_len 没加 volatile
            process(rx_buf, rx_len);
            rx_len = 0;
        }
    }
}
```

现象：**串口收到的数据时有时无，偶尔一条完整的也收不到**。

原因：`main` 的 `while` 里 `rx_len` 被优化进寄存器，中断里改的是内存，主循环一直读旧值。加 `volatile uint16_t rx_len;` 后恢复正常。

更进一步，`rx_len = 0` 和中断里的 `rx_len++` 仍有竞争，标准写法应该是环形缓冲区（见下一篇文章）。

---

总结成一句话：**`volatile` 是对编译器说话（别缓存），`const` 是对同事说话（我不会改），`static` 是对链接器说话（别外露）。**
