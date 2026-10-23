---
title: "函数指针与回调：C 语言里的「面向对象」"
description: "为什么函数指针的声明那么难读？驱动 ops 结构体、中断回调、状态机跳转表——嵌入式里三种真正用得上的写法"
pubDate: 2026-10-23
tags: ["C语言", "函数指针", "回调", "状态机", "驱动"]
platform: "通用"
category: "工具"
difficulty: "进阶"
---

函数指针是 C 语言从「流程式脚本」走向「可维护系统」的分水岭。它让代码能在运行时选择行为，而不是在编译时写死。

## 声明为什么这么难读

```c
int (*fp)(int, int);
```

从左往右读：`fp` 是一个指针 `*`，指向函数，这个函数接受 `(int, int)`，返回 `int`。

关键在于**括号**。少了它含义完全变了：

```c
int *fp(int, int);      // 函数声明：返回 int*，参数是 (int, int)
int (*fp)(int, int);    // 函数指针：指向返回 int 的函数
```

一个记忆法：**`fp` 先和谁结合**。
- `*fp(...)` → `fp` 先和 `()` 结合 → 是函数，返回指针
- `(*fp)(...)` → 括号强制 `fp` 先和 `*` 结合 → 是指针，指向函数

实际项目里别硬记，用 `typedef` 包一层：

```c
typedef int (*binop_t)(int, int);

binop_t add = ...;      // 清爽多了
```

## 三种真正用得上的场景

### 一、回调：把「之后做什么」交给调用者

嵌入式里最常见。按键按下、串口收到一帧、定时器到期——驱动层不知道业务层想干什么，所以留个口子。

```c
typedef void (*key_cb_t)(uint8_t key_id, uint8_t is_long_press);

static key_cb_t g_key_cb = NULL;

void key_register_callback(key_cb_t cb)
{
    g_key_cb = cb;
}

/* 中断或扫描任务里调用 */
static void key_scan(void)
{
    uint8_t id;
    if (key_get_pressed(&id)) {
        if (g_key_cb) {              /* ⚠️ 必须判空 */
            g_key_cb(id, 0);
        }
    }
}

/* 业务层 */
static void on_key(uint8_t id, uint8_t lp)
{
    if (id == 1 && !lp) led_toggle();
}

int main(void)
{
    key_register_callback(on_key);
    while (1) { key_scan(); }
}
```

三个细节：

1. **调用前必须判 `NULL`** —— 没注册就调用是最常见的崩溃原因
2. 回调里**不要做耗时操作**，尤其别在中断里调
3. 回调可能在中断上下文执行，注意共享变量的 `volatile` 和临界区

### 二、ops 结构体：C 里的多态

一套接口，多种实现。Linux 内核到处是这种写法。

```c
typedef struct {
    const char *name;
    int  (*init)(void);
    int  (*read)(uint8_t *buf, size_t len);
    int  (*write)(const uint8_t *buf, size_t len);
    void (*deinit)(void);
} sensor_ops_t;

/* ── 实现 A：MAX31865（SPI）── */
static int max_init(void)  { return spi_init(SPI1, 1000000); }
static int max_read(uint8_t *buf, size_t len) { /* ... */ return 0; }
static int max_write(const uint8_t *buf, size_t len) { return -1; }
static void max_deinit(void) { spi_deinit(SPI1); }

static const sensor_ops_t max31865 = {
    .name   = "MAX31865",
    .init   = max_init,
    .read   = max_read,
    .write  = max_write,
    .deinit = max_deinit,
};

/* ── 实现 B：SHT30（I2C）── */
static const sensor_ops_t sht30 = { .name = "SHT30", .init = sht_init, /* ... */ };

/* ── 业务代码完全不用关心底层是 SPI 还是 I2C ── */
int read_temperature(const sensor_ops_t *ops, float *out)
{
    uint8_t buf[4];
    if (ops->init() != 0) return -1;
    if (ops->read(buf, sizeof(buf)) != 0) return -1;
    *out = parse_temp(buf);
    ops->deinit();
    return 0;
}
```

好处很实在：

- 加新传感器**不用改调用方**
- 单元测试可以塞一个假实现
- 函数表放 `const` 段，进 Flash，不占 RAM

### 三、状态机跳转表：干掉巨型 switch

```c
typedef enum { ST_IDLE, ST_HEAD, ST_BODY, ST_CRC, ST_DONE } state_t;

typedef state_t (*handler_t)(void);

static state_t st_idle(void);
static state_t st_head(void);
static state_t st_body(void);
static state_t st_crc(void);

static const handler_t table[] = {
    [ST_IDLE] = st_idle,
    [ST_HEAD] = st_head,
    [ST_BODY] = st_body,
    [ST_CRC]  = st_crc,
};

void protocol_task(void)
{
    static state_t st = ST_IDLE;
    if (st < sizeof(table) / sizeof(table[0]) && table[st]) {
        st = table[st]();
    }
}
```

`[ST_IDLE] = st_idle` 是 C99 的**指定初始化器**，好处是表的下标和枚举自动对应，加状态时不会错位。

对比 `switch (st) { case ... }`：跳转表更快（O(1)），而且每个状态的处理函数独立，测试时能单独调用。

## 别忘了 qsort

标准库里的经典例子，能说明函数指针的通用性：

```c
int by_value_asc(const void *a, const void *b)
{
    int va = *(const int *)a;
    int vb = *(const int *)b;
    return (va > vb) - (va < vb);   /* 避免相减溢出 */
}

int arr[8] = { 5, 2, 9, 1, 7, 3, 8, 4 };
qsort(arr, 8, sizeof(int), by_value_asc);
```

注意 `return (va > vb) - (va < vb)` 这个写法——直接 `return va - vb` 在数值接近 `INT_MAX`/`INT_MIN` 时会溢出。

## 五个常见坑

| 坑 | 现象 | 解法 |
|---|---|---|
| 未判空就调用 | HardFault / 跳飞到随机地址 | 调用前 `if (fp)` |
| 函数签名不匹配 | 参数错位、返回值乱 | 用 `typedef` 统一签名，编译器会帮你查 |
| 指向局部函数返回的地址 | 栈被复用时崩溃 | 函数指针只能指向静态/全局函数 |
| 表里漏项 | 跳到 `NULL` 或错位 | 用指定初始化器 + 调用前判空 |
| 中断里调耗时回调 | 其他中断被延迟 | 回调只置标志，主循环干活 |

签名不匹配是最阴的——强转能骗过编译器：

```c
void (*fp)(int) = (void (*)(int))some_func_with_two_args;   // ❌ 编译通过，运行炸
```

## 一个完整可用的小例子

按钮「单击 / 长按 / 双击」识别，用函数指针把动作解耦：

```c
typedef enum { EV_NONE, EV_CLICK, EV_LONG, EV_DOUBLE } key_event_t;
typedef void (*key_handler_t)(key_event_t ev);

static key_handler_t g_handler;

static void key_task(void)
{
    static uint32_t press_tick = 0;
    static uint8_t  pressed = 0;

    uint8_t now = key_is_down();

    if (now && !pressed) {           /* 按下 */
        press_tick = tick_ms();
        pressed = 1;
    } else if (!now && pressed) {    /* 抬起 */
        uint32_t dur = tick_ms() - press_tick;
        pressed = 0;
        if (g_handler) {
            g_handler(dur >= 800 ? EV_LONG : EV_CLICK);
        }
    }
}

void key_on_event(key_handler_t h) { g_handler = h; }
```

业务层只管「单击时开灯」：

```c
static void my_key(key_event_t ev)
{
    switch (ev) {
    case EV_CLICK:  led_toggle();   break;
    case EV_LONG:   enter_config(); break;
    default: break;
    }
}

int main(void)
{
    key_on_event(my_key);
    for (;;) key_task();
}
```

按键驱动不认识 `led_toggle`，业务层也不认识按键扫描——**中间只靠一个函数指针连接**。这就是解耦。

## 小结

函数指针的价值不在语法，在于**把「什么时候做什么」从编译期推迟到运行期**：

- 回调 → 驱动与业务解耦
- ops 结构体 → 一套接口多种实现（多态）
- 跳转表 → 状态机、命令分发

写的时候记住两条：**用 `typedef` 简化声明**，**调用前一定判空**。这两条能避免 90% 的函数指针事故。
