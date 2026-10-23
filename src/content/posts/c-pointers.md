---
title: "C 语言指针：从内存地址到嵌入式实战"
description: "指针就是地址，但为什么要有类型？数组名和指针差在哪？二级指针什么时候真的需要？一篇把嵌入式里绕不开的指针问题讲透"
pubDate: 2026-10-23
tags: ["C语言", "指针", "内存", "数组", "基础"]
platform: "通用"
category: "工具"
difficulty: "进阶"
---

指针是 C 语言里唯一「直接操作内存」的手段。嵌入式里你躲不开它——寄存器是地址、缓冲区是地址、DMA 描述符也是地址。

这篇不背概念，只讲「为什么」和「什么时候会炸」。

## 指针到底是什么

一句话：**指针是存地址的变量**。它自己也有地址，也占内存。

```c
uint32_t value = 0x12345678;
uint32_t *p   = &value;
```

内存里大致是这样（假设 `value` 在 0x2000_0000）：

```text
地址            内容              说明
0x20000000     78 56 34 12       value（小端）
0x20000004     00 00 00 20       p，存的是 0x20000000
```

`p` 本身占 4 字节（32 位平台），里面装的是 `value` 的地址。

两个运算符各有两个含义，这是初学者最大的混乱源：

| 符号 | 在声明里 | 在表达式里 |
|---|---|---|
| `*` | 「这是一个指针」`uint32_t *p` | 「取 p 指向的值」`*p` |
| `&` | 「这里取地址」（C++ 的引用） | 「取地址」`&value` |

```c
uint32_t *p = &value;   // 声明里的 * 是类型的一部分；& 是取地址
uint32_t x = *p;        // 这里的 * 是解引用
```

## 为什么指针要有类型

初学者常问：既然都是 4 字节的地址，为什么不能用一个「万能指针」？

因为类型决定了**两件事**：

```c
uint8_t  *p8  = (uint8_t *)0x20000000;
uint32_t *p32 = (uint32_t *)0x20000000;

p8  += 1;   // 地址 +1，前进 1 字节
p32 += 1;   // 地址 +4，前进 4 字节   ← 步长由类型决定

uint32_t a = *p8;    // 只读 1 字节，再零扩展
uint32_t b = *p32;   // 读 4 字节        ← 读取宽度也由类型决定
```

**步长和解引用宽度**都来自类型。用错类型不会报错，只会读出垃圾数据——这是嵌入式里最难查的一类 bug。

`void *` 是个例外：它没有步长（GCC 里 `void* + 1` 等价于 `+1` 字节，但标准不允许，别这么写），也必须先转换类型才能解引用。

## 数组名不是指针

这是面试最爱问的，也是实际会踩的：

```c
uint8_t buf[16];

sizeof(buf);        // 16   ← 整个数组的大小
sizeof(&buf[0]);    // 4    ← 一个指针的大小

sizeof(&buf);       // 4    ← 指向「整个数组」的指针，也是 4 字节
```

`buf` 在大多数表达式里会**退化**成指向首元素的指针，但它本身不是指针——它是数组类型。

什么时候这个区别会咬人？**函数传参**：

```c
void f(uint8_t buf[16])   // 别被 [16] 骗了
{
    sizeof(buf);          // 4，不是 16！
}
```

函数参数里的数组一律退化为指针，`[16]` 只是给人看的注释。所以缓冲区大小必须单独传：

```c
void f(uint8_t *buf, size_t len);
```

**规则：只要把数组传给函数，就同时传长度。** 这条能省掉 90% 的越界 bug。

`a[i]` 和 `*(a + i)` 完全等价，这是 C 标准定义的。所以 `2[buf]` 也合法（等于 `buf[2]`）——但别这么写，会被同事打。

## 指针运算的合法范围

指针只能在同一数组（或一个越过末尾的位置）内运算。越界是未定义行为：

```c
int a[10];
int *p = &a[5];

p + 5;      // ✅ 指向 a[10]，正好越过末尾，合法（但不能解引用）
p + 6;      // ❌ 未定义行为
```

嵌入式里常见这种写法做「末尾哨兵」，是合法的：

```c
uint8_t *end = buf + len;
for (uint8_t *p = buf; p != end; p++) {
    *p ^= 0xFF;
}
```

## 二级指针：什么时候真的需要

大部分场景一级指针就够了。二级指针（`T **`）只在**需要修改指针本身**时才用。

### 场景一：函数内让指针指向别处

```c
// ❌ 不行：改的是副本
void alloc_bad(uint8_t *p) {
    p = malloc(64);
}

// ✅ 需要传指针的地址
void alloc_good(uint8_t **pp) {
    *pp = malloc(64);
}

uint8_t *buf = NULL;
alloc_good(&buf);       // buf 现在指向新内存
```

### 场景二：指针数组的遍历

```c
const char *names[] = { "uart", "i2c", "spi" };
const char **p = names;

while (*p) {
    printf("%s\n", *p);
    p++;
}
```

### 场景三：链表/树的插入删除

```c
typedef struct node {
    int val;
    struct node *next;
} node_t;

// 用二级指针删节点，避免单独处理「删头节点」的特例
void list_remove(node_t **head, int target)
{
    node_t **pp = head;
    while (*pp) {
        if ((*pp)->val == target) {
            node_t *dead = *pp;
            *pp = dead->next;
            free(dead);
            return;
        }
        pp = &(*pp)->next;
    }
}
```

第三种是二级指针最漂亮的用法——**不动头指针的特殊情况**，代码短一半。

## 三种「坏指针」

### 1. 野指针：没初始化

```c
uint8_t *p;         // 里面是随机值
*p = 1;             // 随机往某个地址写 1 —— 可能改掉别的变量，也可能 HardFault
```

**规则：指针声明时一律初始化**。不知道指向哪就写 `NULL`。

```c
uint8_t *p = NULL;
```

### 2. 悬空指针：指向已释放的内存

```c
uint8_t *p = malloc(16);
free(p);
p[0] = 1;           // ❌ 内存已经还给系统了
```

释放后立即置空：

```c
free(p);
p = NULL;
```

### 3. 返回局部变量地址

```c
uint8_t *make_buf(void)
{
    uint8_t buf[32];     // 栈上
    return buf;          // ❌ 函数返回后栈就被复用了
}
```

正确做法：让调用者提供缓冲区，或 `malloc`。

```c
void fill_buf(uint8_t *buf, size_t len);   // ✅ 调用者提供
uint8_t *make_buf(void) { return malloc(32); }  // ✅ 堆上，但要记得 free
```

## 嵌入式里的典型用法

### 寄存器映射

```c
#define PERIPH_BASE   0x40000000UL
#define GPIOA_BASE    (PERIPH_BASE + 0x10800UL)

typedef struct {
    volatile uint32_t CRL, CRH, IDR, ODR, BSRR, BRR, LCKR;
} GPIO_TypeDef;

#define GPIOA  ((GPIO_TypeDef *)GPIOA_BASE)
```

这行强制转换把「一个数字」变成「结构体指针」，之后 `GPIOA->ODR` 就是访问 `0x4001080C`。
**`volatile` 不能漏**，否则编译器会缓存读取结果。

### 遍历缓冲区

```c
void hex_dump(const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        printf("%02X ", data[i]);
        if ((i + 1) % 16 == 0) printf("\n");
    }
}
```

用下标而不是指针自增，可读性更好，编译器优化后性能一样。

### 结构体指针做「接口」

```c
typedef struct {
    int  (*init)(void);
    int  (*read)(uint8_t *buf, size_t len);
    void (*deinit)(void);
} sensor_ops_t;

static const sensor_ops_t max31865_ops = { max_init, max_read, max_deinit };
```

这是 C 里实现多态的常见做法，下一篇会展开讲。

## 一份自检清单

写指针相关代码时过一遍：

| 检查项 | 正确做法 |
|---|---|
| 声明 | 一律初始化，不知道就 `NULL` |
| 使用前 | 判断 `if (p != NULL)` |
| 传数组 | 同时传长度，别用 `sizeof` |
| 释放后 | 立即 `p = NULL` |
| 函数返回 | 不返回局部变量地址 |
| 寄存器 | 指针带 `volatile` |
| 类型转换 | 能用 `memcpy` 就别强转（见结构体对齐那篇） |

## 小结

指针难，不是语法难，是**它把内存暴露给你了**。C 给你自由，代价是你得自己保证正确。

记住三句话：

1. **指针是地址，类型决定步长和解引用宽度**
2. **数组名会退化，函数里拿不到数组长度**
3. **每个指针都要问：它可能指向哪？那块内存还活着吗？**

下一篇讲函数指针——嵌入式里真正让代码「活」起来的东西。
