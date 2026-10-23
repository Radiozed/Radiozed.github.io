---
title: "STM32F103C8T6 引脚全解：48 脚怎么分配才不打架"
description: "LQFP48 完整引脚表、哪些是 5V 容忍、ADC/定时器/串口怎么映射、以及 PA13/PA15/PC13 这几个必踩的坑"
pubDate: 2026-10-23
tags: ["STM32", "引脚定义", "LQFP48", "硬件设计", "选型"]
platform: "STM32"
category: "工具"
difficulty: "进阶"
---

STM32F103C8T6 大概是国内被用得最多的 32 位 MCU——蓝板（Blue Pill）就是它。但引脚分配踩坑的人一点不少：

- PA13/PA14 接了外设，结果烧不进程序
- 用 PA0 做 5V 电平检测，芯片当场报废
- PC13 驱动 LED 发现亮度不够

这篇把 48 个脚整理成能直接查的表，再讲清五个必踩的坑。

## 完整引脚表

| 引脚 | 名称 | 类型 | 电平 | 主功能 | 默认复用 / 重定义 |
|---|---|---|---|---|---|
| 1 | VBAT | S | — | 备份域电源 | 接 3.3V 或纽扣电池 |
| 2 | PC13-TAMPER-RTC | I/O | — | PC13 | TAMPER-RTC |
| 3 | PC14-OSC32_IN | I/O | — | PC14 | OSC32_IN（LSE 晶振） |
| 4 | PC15-OSC32_OUT | I/O | — | PC15 | OSC32_OUT |
| 5 | OSC_IN | I | — | HSE 输入 | 8MHz 晶振 |
| 6 | OSC_OUT | O | — | HSE 输出 | 8MHz 晶振 |
| 7 | NRST | I/O | — | 复位 | 低有效 |
| 8 | VSSA | S | — | 模拟地 | — |
| 9 | VDDA | S | — | 模拟电源 | — |
| 10 | PA0-WKUP | I/O | — | PA0 | WKUP / USART2_CTS / ADC12_IN0 / TIM2_CH1_ETR |
| 11 | PA1 | I/O | — | PA1 | USART2_RTS / ADC12_IN1 / TIM2_CH2 |
| 12 | PA2 | I/O | — | PA2 | USART2_TX / ADC12_IN2 / TIM2_CH3 |
| 13 | PA3 | I/O | — | PA3 | USART2_RX / ADC12_IN3 / TIM2_CH4 |
| 14 | PA4 | I/O | — | PA4 | SPI1_NSS / USART2_CK / ADC12_IN4 |
| 15 | PA5 | I/O | — | PA5 | SPI1_SCK / ADC12_IN5 |
| 16 | PA6 | I/O | — | PA6 | SPI1_MISO / ADC12_IN6 / TIM3_CH1 ｜ TIM1_BKIN |
| 17 | PA7 | I/O | — | PA7 | SPI1_MOSI / ADC12_IN7 / TIM3_CH2 ｜ TIM1_CH1N |
| 18 | PB0 | I/O | — | PB0 | ADC12_IN8 / TIM3_CH3 ｜ TIM1_CH2N |
| 19 | PB1 | I/O | — | PB1 | ADC12_IN9 / TIM3_CH4 ｜ TIM1_CH3N |
| 20 | PB2 | I/O | **FT** | PB2 | BOOT1 |
| 21 | PB10 | I/O | **FT** | PB10 | I2C2_SCL / USART3_TX ｜ TIM2_CH3 |
| 22 | PB11 | I/O | **FT** | PB11 | I2C2_SDA / USART3_RX ｜ TIM2_CH4 |
| 23 | VSS_1 | S | — | 数字地 | — |
| 24 | VDD_1 | S | — | 3.3V | — |
| 25 | PB12 | I/O | **FT** | PB12 | SPI2_NSS / I2C2_SMBAI / USART3_CK / TIM1_BKIN |
| 26 | PB13 | I/O | **FT** | PB13 | SPI2_SCK / USART3_CTS / TIM1_CH1N |
| 27 | PB14 | I/O | **FT** | PB14 | SPI2_MISO / USART3_RTS / TIM1_CH2N |
| 28 | PB15 | I/O | **FT** | PB15 | SPI2_MOSI / TIM1_CH3N |
| 29 | PA8 | I/O | **FT** | PA8 | USART1_CK / TIM1_CH1 / MCO |
| 30 | PA9 | I/O | **FT** | PA9 | USART1_TX / TIM1_CH2 |
| 31 | PA10 | I/O | **FT** | PA10 | USART1_RX / TIM1_CH3 |
| 32 | PA11 | I/O | **FT** | PA11 | USART1_CTS / USBDM / CAN_RX / TIM1_CH4 |
| 33 | PA12 | I/O | **FT** | PA12 | USART1_RTS / USBDP / CAN_TX / TIM1_ETR |
| 34 | PA13 | I/O | **FT** | JTMS | **SWDIO** |
| 35 | VSS_2 | S | — | 数字地 | — |
| 36 | VDD_2 | S | — | 3.3V | — |
| 37 | PA14 | I/O | **FT** | JTCK | **SWCLK** |
| 38 | PA15 | I/O | **FT** | JTDI | TIM2_CH1_ETR / PA15 / SPI1_NSS |
| 39 | PB3 | I/O | **FT** | JTDO | TRACESWO / TIM2_CH2 / SPI1_SCK |
| 40 | PB4 | I/O | **FT** | JNTRST | TIM3_CH1 / SPI1_MISO |
| 41 | PB5 | I/O | — | PB5 | I2C1_SMBAI |
| 42 | PB6 | I/O | **FT** | PB6 | I2C1_SCL / TIM4_CH1 ｜ USART1_TX |
| 43 | PB7 | I/O | **FT** | PB7 | I2C1_SDA / TIM4_CH2 ｜ USART1_RX |
| 44 | BOOT0 | I | — | 启动模式 | 10k 下拉到地 |
| 45 | PB8 | I/O | **FT** | PB8 | TIM4_CH3 ｜ I2C1_SCL / CAN_RX |
| 46 | PB9 | I/O | **FT** | PB9 | TIM4_CH4 ｜ I2C1_SDA / CAN_TX |
| 47 | VSS_3 | S | — | 数字地 | — |
| 48 | VDD_3 | S | — | 3.3V | — |

> 表来源于 ST 官方数据手册 DS5319 的 Alternate function mapping。
> 网上的中文版表格（包括本文参考的那份）可以对照，但**做设计时以原厂 PDF 为准**。

## 五个必踩的坑

### 坑一：不是所有 IO 都能接 5V

看上面表格的「电平」列，标了 **FT**（Five-volt Tolerant）的才能接 5V 信号。

**不能接 5V 的**：

```text
PA0 ~ PA7      （全是 ADC 通道）
PB0、PB1       （ADC 通道）
PB5
PC13 / PC14 / PC15
```

规律很清晰：**所有模拟输入引脚都不是 5V 容忍**。因为 FT 的实现是在 IO 上串了一个额外的保护结构，而模拟通道要求直连到 ADC，装不了。

**后果**：5V 直接灌进 PA0，轻则引脚损坏，重则整片芯片供电倒灌、烧毁。

**正确做法**：5V 信号进 PA0 前，必须分压或用 MOS 电平转换（见接口保护那篇）。

### 坑二：PA13 / PA14 是你的救命线

```text
PA13 = SWDIO
PA14 = SWCLK
```

这两个脚是**烧程序的通道**。一旦在代码里把它们配成普通 IO 并输出，或者外部电路把它们拉死，下次就下不进程序了。

**如果非要用**（比如 IO 实在不够）：

```c
/* 只保留 SWD，关掉 JTAG，释放 PA15/PB3/PB4 */
__HAL_AFIO_REMAP_SWJ_NOJTAG();

/* 千万别用这个 —— 会连 SWD 一起关掉，只能用 BOOT0 方式救砖 */
// __HAL_AFIO_REMAP_SWJ_DISABLE();
```

**救砖办法**：把 BOOT0 拉高，从 System Memory 启动，就能重新烧。

> 建议：**PA13/PA14 永远留给调试**。就算量产也要留测试点。

### 坑三：PA15 / PB3 / PB4 默认是 JTAG，不是普通 IO

上电复位后，这五个脚默认是 JTAG 功能：

```text
PA13  SWDIO    ← SWD 需要保留
PA14  SWCLK    ← SWD 需要保留
PA15  JTDI     ← 想要普通 IO 必须 remap
PB3   JTDO
PB4   JNTRST
```

**只调 `__HAL_AFIO_REMAP_SWJ_NOJTAG()` 之后**，PA15/PB3/PB4 才能当普通 IO 用。

很多人点亮第一个 LED 时用 PB3 没反应，就是这个原因。

### 坑四：PC13 驱动能力很弱

PC13/PC14/PC15 属于**备份域**，驱动能力被刻意限制：

- 最大灌电流约 **3mA**（普通 IO 是 20mA）
- 输出速度限制在 2MHz
- 不能作为电流源使用

**只能接 LED（配 1kΩ 以上限流电阻）或做输入检测**，别拿来驱动继电器、蜂鸣器。

而且 PC14/PC15 默认接了 LSE 晶振，如果用 RTC 就不能当 IO。

### 坑五：ADC 只有 10 个通道，且都在 PA0-PA7 / PB0-PB1

```text
IN0  PA0    IN5  PA5
IN1  PA1    IN6  PA6
IN2  PA2    IN7  PA7
IN3  PA3    IN8  PB0
IN4  PA4    IN9  PB1
```

注意：

- **F103C8 没有 DAC**（那是 F103RC 以上才有的）
- **只有一个 ADC**（12 位，1Msps），多通道要靠**轮询或 DMA 分时采样**，不能真正"同时"采样
- ADC 引脚**不能再做 FT**，也不能接 5V
- 参考电压是 **VDDA**，想要高精度就给 VDDA 单独加 LC 滤波或外部基准

## 按功能速查

### 通信接口映射

| 接口 | 默认引脚 | 重映射 |
|---|---|---|
| **USART1** | PA9(TX) / PA10(RX) | PB6 / PB7 |
| **USART2** | PA2(TX) / PA3(RX) | PD5 / PD6（C8T6 无 PD 口，用不了） |
| **USART3** | PB10(TX) / PB11(RX) | PC10 / PC11（C8T6 无 PC 口） |
| **SPI1** | PA5(SCK) / PA6(MISO) / PA7(MOSI) / PA4(NSS) | PB3 / PB4 / PB5 |
| **SPI2** | PB13(SCK) / PB14(MISO) / PB15(MOSI) / PB12(NSS) | — |
| **I2C1** | PB6(SCL) / PB7(SDA) | PB8 / PB9 |
| **I2C2** | PB10(SCL) / PB11(SDA) | — |
| **CAN** | PA11(RX) / PA12(TX) | PB8 / PB9 |
| **USB** | PA11(D-) / PA12(D+) | — |

**几个关键提醒**：

1. **LQFP48 只有 PA/PB/PC13-15**，没有 PC0-PC12 和 PD 口。所以 USART2/3 的重映射在这颗芯片上**基本用不了**——别照着网上 F103ZET6 的代码抄。
2. **USART1 是唯一能自由重映射的**（PA9/PA10 ↔ PB6/PB7）。
3. **CAN 和 USB 抢 PA11/PA12**，不能同时用（除非 CAN 重映射到 PB8/PB9）。
4. **I2C1 和 CAN 抢 PB8/PB9**（当 I2C1 重映射到 PB8/PB9、CAN 重映射到 PB8/PB9 时会冲突）。

### 定时器

| 定时器 | 类型 | 通道引脚 |
|---|---|---|
| **TIM1** | 高级（带死区/刹车） | CH1 PA8 / CH2 PA9 / CH3 PA10 / CH4 PA11<br>CH1N PA7 / CH2N PB0 / CH3N PB1 / BKIN PA6 |
| **TIM2** | 通用 32 位 | CH1 PA0 / CH2 PA1 / CH3 PA2 / CH4 PA3 |
| **TIM3** | 通用 16 位 | CH1 PA6 / CH2 PA7 / CH3 PB0 / CH4 PB1 |
| **TIM4** | 通用 16 位 | CH1 PB6 / CH2 PB7 / CH3 PB8 / CH4 PB9 |

- **只有 TIM1 是高级定时器**，做三相电机、互补 PWM、死区控制只能靠它
- TIM2 是**32 位**的，做长定时比 TIM3/4 好
- TIM1 的互补输出（CH1N/CH2N/CH3N）在 PA7/PB0/PB1 —— 做电机驱动时正好是三对

### 时钟与调试

| 引脚 | 用途 |
|---|---|
| OSC_IN / OSC_OUT (5/6) | 主晶振 HSE，蓝板是 8MHz |
| PC14 / PC15 (3/4) | 32.768kHz 晶振 LSE（RTC 用） |
| PA13 / PA14 | SWD 调试（**务必保留**） |
| PA8 | MCO，可输出内部时钟供示波器测量 |
| NRST (7) | 复位，低有效，内部有上拉 |
| BOOT0 (44) | 启动模式，**必须有下拉电阻** |
| PB2 (20) | BOOT1，一般下拉到地 |

## 引脚分配的实操顺序

画原理图前按这个顺序分配，能避免大部分返工：

```text
1. 电源：VDD×3、VSS×3、VDDA、VSSA、VBAT
2. 时钟：OSC_IN/OUT（HSE）、PC14/15（LSE，如果用 RTC）
3. 调试：PA13 / PA14  ← 绝不占用
4. 启动：BOOT0 下拉、PB2 下拉
5. 主通信：USART1（PA9/PA10）、USB 或 CAN（PA11/PA12）
6. 高速外设：SPI1（PA5/6/7）或 SPI2（PB13/14/15）
7. 模拟输入：PA0-PA7 / PB0 / PB1（注意这些不能做 FT）
8. 剩下的才给普通 GPIO 和 LED
```

**第 3 步放在前面**是这个顺序的关键——很多人先分配外设，最后发现没地方放 SWD。

## 一个最小系统的引脚占用

以「串口 + I2C 传感器 + 2 路 PWM + 4 个按键」为例：

```text
PA13 / PA14        SWD（固定占用）
PA9  / PA10        USART1 调试串口
PB6  / PB7         I2C1（传感器）
PA8  / PA9         ← 冲突！PA9 已被 USART1 占用
                   → TIM1_CH1 改到 PA8，CH2 只能另找
PA0-PA3            4 个按键（注意不能接 5V）
PA5/PA6/PA7        留给 SPI（比如接 OLED）
PC13               LED（低驱动能力，配 1k 电阻）
```

看，**PA9 就冲突了**。这就是为什么必须先把表画出来再选引脚。

## 小结

STM32F103C8T6 的引脚规则可以浓缩成五句话：

1. **带 FT 的才能接 5V**，模拟引脚一律不行
2. **PA13/PA14 永远留给 SWD**
3. **PA15/PB3/PB4 要 remap 才能当普通 IO**
4. **PC13 只能带 LED，不能驱动负载**
5. **LQFP48 没有 PD 口**，网上 ZET6 的例程不能照抄

最后一句：**画板前一定先把引脚分配表列出来**，逐条和这份表对一遍。改原理图 10 分钟，改板子 10 天。
