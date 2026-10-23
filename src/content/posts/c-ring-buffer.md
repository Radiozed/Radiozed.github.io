---
title: "环形缓冲区：串口收数据不丢字节的标准写法"
description: "中断里塞、主循环里取，为什么普通数组会丢数据；SPSC 无锁环形缓冲的完整实现与内存屏障细节"
pubDate: 2026-10-23
tags: ["C语言", "环形缓冲区", "串口", "DMA", "数据结构"]
platform: "通用"
category: "通信"
difficulty: "进阶"
---

串口接收是每个嵌入式的第一课，也是第一个 bug。最常见的写法长这样：

```c
uint8_t  rx_buf[64];
uint16_t rx_len = 0;

void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE) {
        rx_buf[rx_len++] = USART1->DR;
    }
}

int main(void)
{
    while (1) {
        if (rx_len >= 8) {
            handle_frame(rx_buf, 8);
            memmove(rx_buf, rx_buf + 8, rx_len - 8);   // 搬数据
            rx_len -= 8;
        }
    }
}
```

能跑，但有几个问题：

1. `rx_len++` 在中断里，主循环读它——**必须 `volatile`**，否则被优化后读旧值
2. 数组满了怎么办？现在的代码会**越界写**，直接踩坏相邻变量
3. `memmove` 每次都要搬剩下的数据，帧长 8 字节、一次收 64 字节时要搬 7 次
4. 半包/粘包处理全靠 `>= 8` 硬判断，协议一复杂就乱

环形缓冲区（ring buffer）一次解决前三个。

## 核心思想

把缓冲区看成首尾相连的环。两个指针：

- `head`：写入位置，**只有生产者（中断）改**
- `tail`：读取位置，**只有消费者（主循环）改**

写入不移动数据，只转动指针。写满之后 `head` 追上 `tail` 就停，不会越界。

```text
        tail          head
         ↓             ↓
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │   │   │ ● │ ● │ ● │   │   │   │
  └───┴───┴───┴───┴───┴───┴───┴───┘
        已读          待读
```

## 完整实现

```c
#include <stdint.h>

/* 容量必须是 2 的幂，这样取模可以退化成按位与 */
#define RB_SIZE   256u
#define RB_MASK   (RB_SIZE - 1u)

typedef struct {
    volatile uint16_t head;     /* 写指针，仅生产者修改 */
    volatile uint16_t tail;     /* 读指针，仅消费者修改 */
    uint8_t           buf[RB_SIZE];
} rb_t;

void rb_init(rb_t *rb)
{
    rb->head = 0;
    rb->tail = 0;
}

/* 写入一个字节：成功返回 0，缓冲区满返回 -1 */
static inline int rb_put(rb_t *rb, uint8_t byte)
{
    uint16_t h    = rb->head;
    uint16_t next = (uint16_t)((h + 1) & RB_MASK);

    if (next == rb->tail) {
        return -1;                       /* 满：留一个空位用于区分空/满 */
    }

    rb->buf[h] = byte;                   /* 先写数据 */
    rb->head   = next;                   /* 再发布指针 */
    return 0;
}

/* 读出一个字节：成功返回 0，缓冲区空返回 -1 */
static inline int rb_get(rb_t *rb, uint8_t *byte)
{
    uint16_t t = rb->tail;

    if (t == rb->head) {
        return -1;                       /* 空 */
    }

    *byte    = rb->buf[t];
    rb->tail = (uint16_t)((t + 1) & RB_MASK);
    return 0;
}

/* 当前可读字节数 */
static inline uint16_t rb_count(const rb_t *rb)
{
    return (uint16_t)((rb->head - rb->tail) & RB_MASK);
}

/* 剩余可写空间 */
static inline uint16_t rb_free(const rb_t *rb)
{
    return (uint16_t)(RB_SIZE - 1u - rb_count(rb));
}
```

几个设计要点：

### 为什么要留一个空位

如果允许写满，`head == tail` 就同时表示「空」和「满」，无法区分。留一个空位后：

- `head == tail` → 空
- `(head + 1) & MASK == tail` → 满

代价是浪费 1 字节（容量 256 实际可用 255）。

另一条路是用额外的计数器，但计数器又要在两个上下文里改，反而增加竞争。

### 为什么容量要 2 的幂

`(h + 1) & RB_MASK` 比 `(h + 1) % RB_SIZE` 快。对 Cortex-M0 这种没有硬件除法器的芯片，取模要几十个周期，按位与只要 1 个。

**串口中断里每一微秒都算钱**，这个优化很值。

### 顺序很重要

```c
rb->buf[h] = byte;      /* ① 写数据 */
rb->head   = next;      /* ② 再改指针 */
```

如果反过来，消费者可能看到 `head` 已经前进、但 `buf[h]` 还是旧值，读出一个脏字节。

**规则：数据先写好，再发布「有新数据」的信号。**

消费者那边相反：

```c
uint16_t t = rb->tail;
if (t == rb->head) return -1;   /* ① 先看有没有 */
*byte = rb->buf[t];             /* ② 再读数据 */
```

## 一个容易被忽略的细节：编译器屏障

`volatile` 保证「每次都真读内存」，但**不保证指令顺序**。GCC 在 `-O2` 下可能把非 `volatile` 的 `buf[h] = byte` 挪到 `head = next` 之后（因为编译器认为两者无依赖）。

Cortex-M 是强序模型，CPU 不会重排；但**编译器会**。补齐方式：

```c
static inline void compiler_barrier(void)
{
    __asm volatile ("" ::: "memory");
}

/* 生产者 */
rb->buf[h] = byte;
compiler_barrier();
rb->head = next;
```

如果是多核（如 ESP32 双核），还需要硬件屏障：

```c
__DMB();    /* ARM 数据内存屏障 */
```

单核 Cortex-M + `volatile` 通常够用，但如果你的代码要跑在 ESP32 的双核上，**必须加屏障**，否则偶发的「读到旧数据」极难排查。

## 实际用法

中断里只管塞，主循环批量取：

```c
static rb_t g_uart_rb;

void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE) {
        uint8_t byte = (uint8_t)(USART1->DR & 0xFF);
        rb_put(&g_uart_rb, byte);       /* 满了就丢，绝不越界 */
    }
}

int main(void)
{
    rb_init(&g_uart_rb);

    while (1) {
        /* 一次性把能读的都读到本地缓冲，减少循环里反复判断的开销 */
        uint8_t local[64];
        uint16_t n = 0;

        while (n < sizeof(local) && rb_get(&g_uart_rb, &local[n]) == 0) {
            n++;
        }

        if (n > 0) {
            protocol_feed(local, n);    /* 交给协议状态机处理 */
        }
    }
}
```

**关键点**：`rb_put` 满了返回 -1 但不阻塞。中断里绝不能等——数据丢了就丢了，至少不会跑飞。

想统计丢包的话，加一个计数器：

```c
static volatile uint32_t g_drop;

void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE) {
        uint8_t byte = (uint8_t)(USART1->DR & 0xFF);
        if (rb_put(&g_uart_rb, byte) != 0) {
            g_drop++;                    /* 只统计，不处理 */
        }
    }
}
```

跑一段时间看 `g_drop`：不为 0 说明主循环消费太慢，要么加大缓冲区，要么优化处理逻辑。

## 进阶：DMA + 空闲中断

数据量大时（115200 以上，或者要收文件），逐个字节进中断太重。改用 DMA：

```c
#define DMA_BUF_SIZE 512

static uint8_t  g_dma_buf[DMA_BUF_SIZE];
static uint16_t g_last_pos;

/* DMA 循环模式收数据，串口空闲中断表示一帧结束 */
void USART1_IDLE_IRQHandler(void)
{
    if (USART1->SR & USART_SR_IDLE) {
        (void)USART1->DR;                        /* 读 DR 清 IDLE 标志 */

        uint16_t pos = DMA_BUF_SIZE - DMA1_Channel5->CNDTR;

        /* 把 DMA 新增的那一段搬进环形缓冲 */
        while (g_last_pos != pos) {
            rb_put(&g_uart_rb, g_dma_buf[g_last_pos]);
            g_last_pos = (uint16_t)((g_last_pos + 1) % DMA_BUF_SIZE);
        }
    }
}
```

这里有个细节：`g_last_pos` 用 `%` 而不是 `&`（因为 DMA 缓冲不要求 2 的幂）。如果也设成 256/512，同样能用掩码加速。

**注意**：搬数据是在中断里做的，如果一帧很长（比如 1KB），中断会持续很久。更好的做法是只记录「新数据在 DMA 缓冲的哪一段」，让主循环直接处理，环形缓冲都不需要。

## 常见 bug 清单

| 问题 | 现象 | 原因 |
|---|---|---|
| 读出的数据是旧值 | 偶发乱码 | `head`/`tail` 没加 `volatile` |
| 偶尔越界 | 相邻变量被改 | 满判断写成了 `head == tail` |
| 读到半截数据 | 帧解析失败 | 生产者先改指针后写数据 |
| 双核掉数据 | ESP32 上偶发 | 缺 `__DMB()` 硬件屏障 |
| 吞吐上不去 | 高速串口丢包 | 容量用 `%` 取模，或中断里做了太多事 |

## 小结

环形缓冲的价值不只是「不丢数据」，更重要的是**解耦了生产者和消费者的速度差**：

- 中断侧的职责变成「尽快把字节塞进去，然后退出」
- 主循环侧的职责变成「有空就来批量取」
- 两边谁也不会等谁

这套模式适用范围远超串口：ADC 采样、CAN 报文、日志缓冲、音频流，本质都是「一个快生产者 + 一个慢消费者」。

写对它的关键是四句话：**容量取 2 的幂、留一个空位、数据先于指针、指针必须 `volatile`。**
