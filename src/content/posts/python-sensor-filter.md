---
title: "传感器数据的三种滤波：中值、滑动平均、一阶低通"
description: "采到的温度曲线毛刺太多？三种滤波各自的适用场景、Python 实现，以及哪一种能写进单片机"
pubDate: 2026-10-23
tags: ["Python", "数据处理", "滤波", "numpy", "传感器"]
platform: "通用"
category: "传感器"
difficulty: "进阶"
---

传感器数据几乎没有「干净」的。AD 噪声、电源纹波、接触不良、通信丢包，都会让曲线长出一堆毛刺。滤波不是把数据变好看，而是**把噪声和真实变化分开**。

三种最常用的方法，各有各的适用场景。

## 先看数据长什么样

```python
import numpy as np
import matplotlib.pyplot as plt

# 从串口记录器导出的 CSV 里取一列温度
data = np.loadtxt("sensor_log.csv", delimiter=",", skiprows=1, usecols=1)
t = np.arange(len(data)) * 0.1      # 假设 10Hz 采样

plt.plot(t, data, lw=0.8)
plt.xlabel("时间 (s)"); plt.ylabel("温度 (℃)")
plt.show()
```

典型症状：

- **孤立尖刺**（某几个点突然跳到天上再掉回来）→ 中值滤波
- **整体抖动**（每个点都在真实值上下小幅随机跳动）→ 滑动平均
- **数据量大、要实时处理** → 一阶低通

## 一、中值滤波：专治孤立尖刺

原理：取窗口内的中位数代替当前值。中位数对极端值不敏感，一个离谱的野值会被直接忽略。

```python
def median_filter(x, k=5):
    """k 必须是奇数；边界用复制填充，避免两端塌陷"""
    pad = k // 2
    xp = np.pad(x, pad, mode="edge")
    return np.array([np.median(xp[i:i + k]) for i in range(len(x))])
```

**适用**：偶发的通信错误、AD 偶发跳变、按键抖动。
**不适用**：真实的高频变化（比如振动信号），中值会把它抹平。

`k` 怎么选？窗口越大去刺越狠，但延迟也越大（输出滞后 `k/2` 个采样点）。温度这种慢变量用 5，快变量用 3。

## 二、滑动平均：压随机噪声

原理：窗口内取平均。噪声是零均值随机的，平均之后互相抵消。

```python
def moving_average(x, k=8):
    kernel = np.ones(k) / k
    return np.convolve(x, kernel, mode="same")
```

`mode="same"` 会让两端出现「边缘效应」——因为补零参与平均，开头几个值会偏低。修正方式是 `mode="valid"` 然后接受结果变短，或者用 `np.pad(..., mode="edge")` 先填充。

**适用**：白噪声（每一帧都在真值附近随机跳）。
**注意**：它对**脉冲噪声无效**——一个野值会被平均到周围 `k` 个点里，反而污染一片。所以通常是「先中值去刺，再滑动平均压噪」：

```python
clean = moving_average(median_filter(data, 5), 8)
```

**代价**：滑动平均的阶跃响应是斜坡，突变会被拖慢。窗口 8 意味着大约要 8 个采样点才能跟上一次真实跳变。

## 三、一阶低通：能写进单片机的那个

前两种都要存一个窗口的数据，内存小、采样快的 MCU 上不划算。一阶低通只需要**一个状态变量**：

```python
def lowpass(x, alpha=0.1):
    y = np.empty_like(x)
    y[0] = x[0]
    for i in range(1, len(x)):
        y[i] = y[i - 1] + alpha * (x[i] - y[i - 1])
    return y
```

就一行递推：`y += α * (x - y)`。

- `α` 越小 → 越平滑，但跟随越慢
- `α = 1` → 等于不滤波
- `α → 0` → 几乎不动

它本质是 RC 低通滤波器的离散形式。`α` 和截止频率的关系：

```text
α = 1 - exp(-2π · fc / fs)
```

比如采样率 `fs = 10Hz`，想要 `fc = 0.5Hz` 的截止频率：

```python
fs, fc = 10, 0.5
alpha = 1 - np.exp(-2 * np.pi * fc / fs)     # ≈ 0.269
```

**C 版本**（直接抄进单片机）：

```c
typedef struct {
    float y;
    float alpha;
} lpf_t;

static inline float lpf_update(lpf_t *f, float x)
{
    f->y += f->alpha * (x - f->y);
    return f->y;
}

/* 初始化 */
lpf_t temp_filter = { .y = 0.0f, .alpha = 0.27f };
```

三个注意事项：

1. **用 `float` 还是 `double`**：Cortex-M0 没有 FPU，`float` 也是软浮点，慢。可以改成定点：`y += (x - y) >> 3`（α = 1/8）
2. **初始值**：`y` 从 0 开始的话，前十几个采样点会「爬」上来。用第一次采到的真实值初始化
3. **别在中断里算**：递推有状态，放主循环或定时任务里

## 三种方法对比

| | 中值 | 滑动平均 | 一阶低通 |
|---|---|---|---|
| 去孤立尖刺 | ★★★ | ✗ | ★ |
| 压随机噪声 | ★★ | ★★★ | ★★ |
| 内存占用 | 窗口 k | 窗口 k | **1 个变量** |
| 计算量 | 要排序，较重 | 加法，轻 | **1 乘 1 加** |
| 相位延迟 | k/2 | (k-1)/2 | 由 α 决定 |
| 适合 MCU | 不太适合 | 勉强 | **非常适合** |
| 阶跃响应 | 保持跳变 | 斜坡 | 指数逼近 |

## 实际怎么配

按数据特征选，别一股脑全上：

```python
# 温度：慢变量，先中值去毛刺，再低通平滑
temp_clean = lowpass(median_filter(temp, 5), alpha=0.2)

# 电压：只有随机噪声，滑动平均就够
volt_clean = moving_average(volt, 16)

# 电流：要实时，MCU 里跑，只用一阶低通
curr_clean = lowpass(curr, alpha=0.1)
```

## 出图对比

```python
fig, axes = plt.subplots(3, 1, figsize=(10, 7), sharex=True)

axes[0].plot(t, data, lw=0.6, color="#bbb")
axes[0].set_title("原始")

axes[1].plot(t, median_filter(data, 5), lw=1.0, color="#E4668F")
axes[1].set_title("中值滤波 k=5")

axes[2].plot(t, lowpass(median_filter(data, 5), 0.2), lw=1.2, color="#3FB98A")
axes[2].set_title("中值 + 一阶低通 α=0.2")
axes[2].set_xlabel("时间 (s)")

plt.tight_layout()
plt.savefig("filter_compare.png", dpi=140)
```

看图判断效果，比盯着数字靠谱得多。几个判断标准：

- **毛刺还在？** 窗口太小，或该用中值却用了均值
- **跟不上突变？** α 太小 / 窗口太大
- **曲线整体偏移了？** 边缘效应，或者滤波引入了直流偏置

## 一个常被忽略的问题：采样率

滤波只能处理**已经采到的数据**。如果信号本身变化比采样率还快，那就是**混叠**，任何滤波都救不回来。

Nyquist 定理：采样率至少是信号最高频率的 2 倍，工程上取 5–10 倍。

温度这种秒级变化，1Hz 采样绰绰有余。但如果你在测电机电流（PWM 频率 20kHz），采样率 1kHz 采到的就是完全失真的混叠信号——**这时候要在 ADC 前面加硬件 RC 低通**，软件滤波无能为力。

## 小结

选滤波器的顺序，我一般这样走：

1. **先看原始曲线**，判断噪声是「孤立尖刺」还是「整体抖动」
2. **尖刺 → 中值**；**抖动 → 均值**；**要上 MCU → 一阶低通**
3. **别过度滤波**：滤波越狠，真实变化越难看出来。温度曲线平滑到毫无波动时，你反而看不出探头脱焊了
4. **原始数据一定留档**：CSV 里同时存原始值和滤波值，事后想换算法还能重算

最后一句实话：滤波能改善显示效果，但**不能提高测量精度**。如果传感器本身的误差就有 ±0.5℃，再怎么平滑也到不了 ±0.1℃。想更准，得从传感器、基准源、走线屏蔽上去解决。
