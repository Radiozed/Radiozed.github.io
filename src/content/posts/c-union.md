---
title: "C 语言联合体：同一块内存，多种解释"
description: "union 不是「省内存的 struct」那么简单——大小端检测、float 拆位、变体类型、寄存器位域视图，四种真正有用的用法和它们的坑"
pubDate: 2026-10-23
tags: ["C语言", "联合体", "union", "位域", "内存"]
platform: "通用"
category: "工具"
difficulty: "进阶"
---

很多人学到 `union` 时的印象是「一个能省内存的 struct」。这个理解不算错，但完全没抓到重点。

`union` 的本质是：**同一块内存，可以有多种解释方式**。它的价值在于「视图转换」，省内存只是顺带的副作用。

## 先搞清楚它和 struct 的区别

```c
struct S {
    uint8_t  a;   /* offset 0 */
    uint32_t b;   /* offset 4（中间填充 3 字节）*/
};                /* sizeof = 8 */

union U {
    uint8_t  a;
    uint32_t b;
};                /* sizeof = 4 */
```

| | struct | union |
|---|---|---|
| 内存布局 | 成员**依次排列** | 成员**全部重叠**在同一地址 |
| 大小 | 各成员之和 + 填充 | **最大成员**的大小（还要对齐） |
| 同时有效 | 所有成员 | **同一时刻只有一个** |
| 改一个成员 | 不影响其他 | **会覆盖其他** |

```c
union U u;
u.b = 0x12345678;
printf("%02X\n", u.a);   /* 小端机器上输出 78 —— b 的最低字节 */
```

`u.a` 和 `u.b` 起始地址相同。写 `b` 之后，`a` 读到的就是 `b` 的第一个字节。

## 用法一：检测大小端

这是最经典的用法，也是我调试新板子时第一段代码：

```c
static inline int is_little_endian(void)
{
    union {
        uint32_t word;
        uint8_t  byte[4];
    } probe = { .word = 0x01020304 };

    return probe.byte[0] == 0x04;
}
```

小端机器上低字节在低地址，`byte[0]` 是 `0x04`；大端是 `0x01`。

比指针强转更干净：

```c
int x = 1;
return *(char *)&x == 1;   /* 也能用，但严格来说有别名问题 */
```

## 用法二：float 与位模式互转

嵌入式里经常需要拆 IEEE754 浮点数——查符号位、取指数、或者给协议做位级打包。

```c
typedef union {
    float    f;
    uint32_t u;
    struct {
        uint32_t mantissa : 23;
        uint32_t exponent : 8;
        uint32_t sign     : 1;
    } bits;
} float_view_t;

void dump_float(float v)
{
    float_view_t fv = { .f = v };
    printf("%f = 0x%08X | sign=%u exp=%u mant=%u\n",
           v, fv.u, fv.bits.sign, fv.bits.exponent, fv.bits.mantissa);
}
```

⚠️ **位域的顺序是实现定义**。上面假设「从低位开始分配」（ARM GCC 和 x86 都这样），但在某些编译器上会反过来。所以拆分位域只适合调试打印，**不要拿它做协议解析**。

更可移植的写法是手动移位：

```c
uint32_t u;
memcpy(&u, &v, sizeof(u));      /* 拿位模式，避开别名问题 */
uint32_t sign     = (u >> 31) & 0x1;
uint32_t exponent = (u >> 23) & 0xFF;
uint32_t mantissa =  u        & 0x7FFFFF;
```

## 用法三：协议帧的多种视图

收一帧数据，有时想按字节看，有时想按字段看：

```c
typedef union {
    uint8_t raw[8];              /* 按字节：打印、校验、拷贝 */
    struct {
        uint8_t  head;
        uint16_t id;
        uint16_t value;
        uint8_t  flag;
        uint8_t  crc;
    } field;                     /* 按字段：业务逻辑 */
} frame_u_t;

frame_u_t f;
memcpy(f.raw, rx_buf, 8);        /* 先拷进来（避免对齐问题）*/

if (f.field.head == 0xA5) {
    process(f.field.id, f.field.value);
}
```

**但这里有个大坑**：`struct` 里有 `uint8_t head` 后面跟 `uint16_t id`，中间会**填充 1 字节**，导致 `field` 和真实帧布局对不上。

两个办法：

1. 用 `#pragma pack(1)` / `__attribute__((packed))` —— 但注意非对齐访问，Cortex-M0 上会 HardFault
2. **按字段顺序设计成自然对齐**，或者干脆用逐字节解析函数

我的建议：**协议解析不要依赖 union + struct 的内存布局**，那篇结构体对齐的文章讲得比较细。union 更适合用在「已经对齐好的数据」上做视图切换。

## 用法四：变体类型（带标签的 union）

这个用法在配置系统、CAN 报文、脚本引擎里非常常见：

```c
typedef enum { VAL_INT, VAL_FLOAT, VAL_STR, VAL_BYTES } val_type_t;

typedef struct {
    val_type_t type;
    union {
        int32_t  i;
        float    f;
        char     str[16];
        uint8_t  bytes[16];
    } as;
} value_t;

void print_value(const value_t *v)
{
    switch (v->type) {
    case VAL_INT:   printf("%ld\n", (long)v->as.i); break;
    case VAL_FLOAT: printf("%.3f\n", v->as.f);      break;
    case VAL_STR:   printf("%s\n",   v->as.str);    break;
    case VAL_BYTES: hex_dump(v->as.bytes, 16);      break;
    }
}
```

**`type` 字段（tag）是必须的**。没有它，你根本不知道当前哪个成员有效——这正是 C 和「真正的动态类型」之间的差距，但足够用了。

这个模式还有个好处：`sizeof(value_t)` 只有一个最大成员 + tag，比「四个字段都留着」省不少 RAM。MCU 上很值。

## 用法五：省 RAM（同一时刻只用其一）

```c
typedef struct {
    uint8_t type;
    union {
        struct { float temp; float humi; }  th;     /* 温湿度传感器 */
        struct { uint32_t pressure; }       baro;   /* 气压计 */
        struct { uint16_t adc[4]; }         raw;    /* 原始 ADC */
    } data;
} sample_t;
```

一次采样只可能是其中一种，没必要三份都占着。这在 RAM 只有几 KB 的 MCU 上是实打实的收益。

## 三个必须知道的坑

### 坑一：读「没写的成员」是实现定义

```c
union U u;
u.f = 3.14f;
uint32_t x = u.u;      /* 读另一个成员 */
```

C99 起允许「类型双关」（type punning 通过 union），**GCC/Clang 明确支持**，但严格按标准这是「实现定义」。要绝对可移植就用 `memcpy`：

```c
uint32_t x;
memcpy(&x, &u.f, sizeof(x));
```

`memcpy` 版本在现代编译器上会被优化成一条 `vmov`，**没有任何性能损失**，还完全规避了别名问题。

### 坑二：union 不能直接比较

```c
union U a, b;
if (a == b) { }        /* ❌ 编译错误 */
if (memcmp(&a, &b, sizeof(a)) == 0) { }   /* ✅ 但填充字节可能是随机值！ */
```

用 `memcmp` 比较 union 也不可靠——填充字节的内容是不确定的。要比较就逐个有效成员比。

### 坑三：初始化只作用于第一个成员

```c
union U u = { 42 };          /* 初始化的是第一个成员 a（uint8_t），且被截断 */
union U u = { .b = 42 };     /* ✅ C99 指定初始化器，明确 */
```

写 union 的初始化**一律用指定初始化器**，否则很容易初始化错成员，后面读出来是垃圾。

## union 和位域的经典组合

寄存器操作里很常见，但要清楚它的可移植性边界：

```c
typedef union {
    uint32_t all;
    struct {
        uint32_t enable   : 1;
        uint32_t mode     : 2;
        uint32_t reserved : 5;
        uint32_t count    : 8;
    } bit;
} ctrl_reg_t;

ctrl_reg_t r;
r.all = 0;
r.bit.enable = 1;
r.bit.mode   = 2;
write_reg(CTRL_ADDR, r.all);      /* 一次性写出 */
```

好处是「按位配置」和「整体读写」都方便。风险是位域顺序和填充由编译器决定——**同一个头文件在不同工具链上编译出的位布局可能不同**。

所以：**只在自己工程的内部寄存器抽象里用**，别拿它跨平台传数据。

## 一份速查

| 想做的事 | 用什么 |
|---|---|
| 同一时刻只需一种数据 | union（省 RAM） |
| 需要区分当前是哪一种 | struct（tag）+ union |
| 位模式 ↔ 数值转换 | union 或 `memcpy`（后者更稳） |
| 从字节流解析协议 | **逐字节解析函数**，不要靠 struct 布局 |
| 寄存器位配置 | union + 位域，仅限本工程内部 |

## 小结

`union` 的核心心智模型只有一句话：**同一块内存，多种解释**。

- 省内存是它的**副作用**，视图切换才是**主要用途**
- 带 tag 的 union（变体类型）是 C 里最实用的设计模式之一
- 涉及跨字节序、跨编译器时，**用 `memcpy` 代替 union 双关**更安全
- 位域 + union 只在内核内部用，别用于协议

指针让你能「指向别人的内存」，union 让你能「用不同角度看同一块内存」。两个合起来，你就真正掌握了 C 的内存模型。
