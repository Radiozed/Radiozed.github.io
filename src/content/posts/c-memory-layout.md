---
title: "程序的内存五区：为什么全局变量会占 Flash，也会占 RAM"
description: ".text/.rodata/.data/.bss/堆栈，各放什么、谁的初始值存在 Flash、为什么大数组能让单片机上电就崩"
pubDate: 2026-10-23
tags: ["C语言", "内存布局", "栈溢出", "MAP文件", "STM32"]
platform: "通用"
category: "工具"
difficulty: "进阶"
---

「内存不够了」是嵌入式最常见的报错，但到底是哪块内存不够？答案取决于变量放在哪个段。

## 五个区

```text
高地址
┌──────────────┐
│     stack    │ ← 局部变量、函数调用帧（向下增长）
├──────────────┤
│      ↓       │
│              │
│      ↑       │
├──────────────┤
│     heap     │ ← malloc / free（向上增长）
├──────────────┤
│     .bss     │ ← 未初始化 / 初始化为 0 的全局、静态变量
├──────────────┤
│     .data    │ ← 有非零初值的全局、静态变量
├──────────────┤
│    .rodata   │ ← 字符串常量、const 全局
├──────────────┤
│     .text    │ ← 机器指令
└──────────────┘
低地址
```

在 MCU 上，前三个（`.text`、`.rodata`、`.data` 的**初始值**）住在 **Flash**，后四个（`.data` 的运行副本、`.bss`、heap、stack）住在 **RAM**。

## 一个容易搞错的事实

```c
int   g_zero;             /* .bss   */
int   g_value = 42;       /* .data  */
const int g_const = 100;  /* .rodata */
char  g_str[] = "hello";  /* .data（可写副本） */
const char *g_p = "hi";   /* 指针在 .data，"hi" 在 .rodata */

void f(void)
{
    int   local = 1;      /* stack */
    static int s = 5;     /* .data（只初始化一次）*/
    static int s0;        /* .bss  */
}
```

注意 `g_value`：**它既占 Flash 也占 RAM**。

- Flash 里存的是它的**初始值 42**
- 上电后启动代码会把 42 从 Flash **拷贝**到 RAM
- 之后程序读写的都是 RAM 里那份

而 `g_zero` 不占 Flash——启动代码只需要把它在 RAM 里**清零**（`.bss` 段就是"C 标准要求静态变量初始为 0"的实现方式）。

**所以「把大数组初始化成 0」能省 Flash**：

```c
uint8_t buf1[4096] = {0};      /* 初始化器全 0 → 编译器通常放进 .bss，不占 Flash */
uint8_t buf2[4096] = {1};      /* 第一个是 1，其余 0 → 必须进 .data，占 4KB Flash */
```

在很多工具链上，`= {0}` 会被优化进 `.bss`。但不保证所有编译器都这么做，写 `uint8_t buf1[4096];`（全局，本身就在 `.bss`）最稳。

## 为什么大数组会让单片机上电就崩

典型场景：STM32F103C8T6，RAM 只有 20KB。

```c
uint8_t frame_buf[8192];       /* 8KB，还好 */
uint8_t dma_buf[16384];        /* 16KB —— 加上前面的就 24KB 了，超了 */
```

现象是**上电直接不进 main**，或者 HardFault。原因是启动代码拷贝 `.data` 或清 `.bss` 时越界踩到了栈。

**排查方法**：看 MAP 文件。

```text
Memory Configuration
Name             Origin             Length      Used
FLASH            0x08000000         0x00010000  0x3a1c
RAM              0x20000000         0x00005000  0x4f80    ← 20KB 里用了 19.9KB
```

或者看链接器输出的 `size`：

```bash
arm-none-eabi-size firmware.elf
#    text    data     bss     dec     hex
#   14876     312    9216   24404    5f54
#   ↑Flash  ↑既占Flash也占RAM  ↑只占RAM
```

`RAM 占用 ≈ data + bss`。如果这个数接近芯片容量，随便加个缓冲区就会溢出。

## 栈：最容易爆的地方

栈的大小在启动文件里定义（STM32 常见 `Stack_Size EQU 0x400`，即 1KB）。

爆栈的三个常见原因：

### 1. 大局部数组

```c
void process(void)
{
    uint8_t buf[2048];       /* 直接在栈上开 2KB —— 1KB 的栈立刻爆 */
}
```

**规则：超过 64 字节的局部数组，一律改成 `static` 或全局。**

### 2. 递归

```c
int fib(int n) { return n < 2 ? n : fib(n-1) + fib(n-2); }
```

每层调用至少占几十字节，深度 100 就危险。嵌入式里**基本不该用递归**。

### 3. printf 浮点

```c
printf("%.3f\n", 3.14159);   /* 某些 newlib-nano 配置下会吃掉 1KB+ 栈 */
```

要么改用整数打印（乘 1000 再输出），要么把 `Stack_Size` 调大。

## heap：MCU 上尽量别用

`malloc` 在单片机上问题不少：

- **碎片**：反复分配释放不同大小，最终总空闲够但拿不到连续块
- **不确定性**：分配耗时不定，破坏实时性
- **失败处理**：`malloc` 返回 `NULL` 后随手解引用就是 HardFault

替代方案优先级：

1. **静态分配**（编译期确定所有缓冲区）—— 最推荐
2. **内存池**（固定大小块，O(1) 分配，无碎片）
3. **`malloc`** —— 只在初始化阶段用，运行期不用

```c
/* 内存池的简化实现 */
#define POOL_BLOCK  64
#define POOL_COUNT  16

static uint8_t pool_mem[POOL_BLOCK * POOL_COUNT];
static uint8_t pool_used[POOL_COUNT];

void *pool_alloc(void)
{
    for (int i = 0; i < POOL_COUNT; i++) {
        if (!pool_used[i]) {
            pool_used[i] = 1;
            return &pool_mem[i * POOL_BLOCK];
        }
    }
    return NULL;
}

void pool_free(void *p)
{
    if (!p) return;
    size_t off = (uint8_t *)p - pool_mem;
    if (off % POOL_BLOCK == 0 && off / POOL_BLOCK < POOL_COUNT) {
        pool_used[off / POOL_BLOCK] = 0;
    }
}
```

分配和释放都是 O(n) 但 n 很小，关键是**没有碎片**、耗时确定。

## 常见 bug 对照

| 现象 | 可能原因 | 排查 |
|---|---|---|
| 上电不进 main | RAM 被 `.data`+`.bss` 占满 | 看 MAP / `size` 输出 |
| 偶发 HardFault | 栈溢出 | 调试器看 SP 是否越过栈底，或填充魔数检测 |
| 全局变量被莫名改写 | 数组越界写坏了相邻变量 | 在数组后加 `canary` 值检测 |
| `malloc` 后面用崩 | 返回 `NULL` 没判断 | 检查返回值 |
| Flash 不够但 RAM 富余 | 大初值数组进了 `.data` | 改成 `.bss`（不初始化或 `= {0}`） |

## 栈溢出检测的小技巧

启动时把栈区填成固定图案，运行时检查还剩多少：

```c
#define STACK_FILL  0xCD

extern uint32_t _sstack;    /* 链接脚本里定义的栈顶 */
extern uint32_t _estack;

void stack_paint(void)
{
    uint32_t *p = &_sstack;
    while (p < &_estack) *p++ = STACK_FILL;
}

uint32_t stack_free_words(void)
{
    uint32_t *p = &_sstack;
    uint32_t n = 0;
    while (p < &_estack && *p == STACK_FILL) { p++; n++; }
    return n;
}
```

栈是从高地址往低地址长的，所以被填满图案的区域就是**没用过**的部分。跑一段时间后看 `stack_free_words()`，如果接近 0 就说明该加大栈了。

（符号名取决于你的启动文件和链接脚本，STM32 上常见的是 `_estack`。）

## 小结

把这张表记住，比背概念有用：

| 变量 | 段 | 占 Flash | 占 RAM |
|---|---|---|---|
| 函数代码 | `.text` | ✅ | |
| `const` 全局 / 字符串 | `.rodata` | ✅ | |
| 有初值的全局/静态 | `.data` | ✅（初始值） | ✅ |
| 无初值 / `= {0}` 的全局 | `.bss` | | ✅ |
| 局部变量 | `stack` | | ✅ |
| `malloc` | `heap` | | ✅ |

三个最常见的救火动作：

1. **RAM 不够** → 查 `.bss` 有没有巨型缓冲区，改用「分时复用」或缩小
2. **Flash 不够** → 查 `.data` 里的大初值数组，改成运行时赋值
3. **上电就崩** → 十有八九是 `.bss` + `.data` 超了 RAM，看 MAP 文件
