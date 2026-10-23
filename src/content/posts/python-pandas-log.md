---
title: "pandas 处理传感器日志：对齐、降采样、找异常"
description: "多路传感器采样率不一致怎么对齐、几十万行怎么快速统计、怎么自动挑出可疑数据点"
pubDate: 2026-10-23
tags: ["Python", "pandas", "数据分析", "传感器", "日志"]
platform: "通用"
category: "传感器"
difficulty: "进阶"
---

用串口记录器跑一晚，第二天面对一个几十万行的 CSV。肉眼翻是不可能的，`pandas` 几分钟能给出结论。

## 读进来

```python
import pandas as pd

df = pd.read_csv('sensor_log.csv',
                 encoding='utf-8-sig',      # 带 BOM，Excel 存的中文表头
                 parse_dates=['时间'])
```

`encoding='utf-8-sig'` 能吃掉 BOM，否则第一列名会变成 `\ufeff时间`，后面全部对不上。

多个文件一起读：

```python
from pathlib import Path

files = sorted(Path('logs').glob('*.csv'))
df = pd.concat(
    [pd.read_csv(f, encoding='utf-8-sig', parse_dates=['时间']) for f in files],
    ignore_index=True
).sort_values('时间').reset_index(drop=True)
```

`ignore_index=True` 很关键——不重置索引的话，后面的 `merge_asof`、`resample` 都会出问题。

## 先做三件体检

```python
print(df.shape)                 # (524288, 4)
print(df.dtypes)                # 时间要确认是 datetime64
print(df.isna().sum())          # 每列缺失多少
```

还要看时间间隔是否均匀：

```python
dt = df['时间'].diff().dt.total_seconds().dropna()
print(dt.describe())
```

如果 `std` 很大、`max` 出现几十秒的空洞，说明**采集中断过**，后面做平均、积分都要小心。

## 对齐两路不同采样率的数据

温度 10Hz，气压 1Hz，想画在同一张图上做相关性分析。

常见的错误做法是「按行 concat」——两路行数不同，直接错位。

正确工具是 `merge_asof`：**给每一行温度，找时间上最接近的气压值**。

```python
temp = df[['时间', '温度']].dropna().sort_values('时间')
baro = df[['时间', '气压']].dropna().sort_values('时间')

merged = pd.merge_asof(
    temp, baro,
    on='时间',
    direction='nearest',                       # 找最近的一条
    tolerance=pd.Timedelta('2s')               # 超过 2 秒就算没有
)

print(merged['气压'].isna().sum())             # 有多少温度点找不到对应气压
```

`tolerance` 一定要给。不给的话，气压传感器掉线一小时，那一小时内的温度点都会被强行配上同一个旧值，分析结论全错。

## 降采样：把 10Hz 变成 1 分钟

```python
m = (df.set_index('时间')
       .resample('1min')
       .agg({'温度': ['mean', 'min', 'max', 'std'],
             '湿度': 'mean'})
       .dropna(how='all'))

m.columns = ['_'.join(c) for c in m.columns]   # 扁平化多级列名
```

`resample` 会按时间窗口分桶，比 `groupby` 手动按秒数整除更准（能处理时间不连续）。

常用频率字符串：`'10s'`、`'1min'`、`'5min'`、`'1H'`、`'1D'`。

## 滚动统计：看趋势而不是看原始值

```python
df['温度_平滑'] = df['温度'].rolling(window=50, min_periods=1).mean()
df['温度_波动'] = df['温度'].rolling(window=50, min_periods=1).std()
```

`min_periods=1` 让开头那几个点也有值（否则前 49 个是 NaN）。

想看「5 分钟内变化了多少」：

```python
df['5min变化'] = df['温度'].diff(periods=300)   # 10Hz × 300 = 30 秒
```

注意 `periods` 是**行数**不是时间。采样率变了，这个数要跟着改。用时间索引更稳：

```python
s = df.set_index('时间')['温度']
s.diff(freq='5min')      # 按时间差，不是按行数
```

## 找异常点

### 方法一：3σ（适合近似正态的噪声）

```python
mu, sd = df['温度'].mean(), df['温度'].std()
outliers = df[(df['温度'] - mu).abs() > 3 * sd]
print(f'发现 {len(outliers)} 个超 3σ 的点')
```

### 方法二：IQR（对偏态更稳）

```python
q1, q3 = df['温度'].quantile([0.25, 0.75])
iqr = q3 - q1
lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
outliers = df[(df['温度'] < lo) | (df['温度'] > hi)]
```

### 方法三：突变检测（最实用）

传感器最典型的故障是「跳变」而不是「慢慢偏」：

```python
df['跳变'] = df['温度'].diff().abs()
bad = df[df['跳变'] > 2.0]      # 单次变化超过 2℃ 就认为可疑
print(bad[['时间', '温度', '跳变']].head(20))
```

这个方法对「探头接触不良」特别有效——接触瞬间温度会猛跌几十度。

## 分组统计

按小时看夜间和白天的差异：

```python
df['小时'] = df['时间'].dt.hour

stat = df.groupby('小时')['温度'].agg(['mean', 'min', 'max', 'count'])
print(stat.round(2))
```

按天：

```python
daily = df.set_index('时间').resample('1D')['温度'].agg(['mean', 'max', 'min'])
daily['极差'] = daily['max'] - daily['min']
```

## 一段时间内的有效数据率

采集系统最该关注的指标之一：

```python
span = (df['时间'].max() - df['时间'].min()).total_seconds()
expect = span * 10          # 期望 10Hz
actual = len(df)
print(f'期望 {expect:.0f} 点，实收 {actual} 点，有效数据率 {actual/expect:.1%}')
```

低于 95% 就说明丢包严重，得回头看串口缓冲区或者主循环消费速度。

## 导出结论

```python
with pd.ExcelWriter('report.xlsx', engine='openpyxl') as w:
    daily.to_excel(w, sheet_name='按天')
    stat.to_excel(w, sheet_name='按小时')
    outliers.head(1000).to_excel(w, sheet_name='异常点', index=False)
    merged.describe().to_excel(w, sheet_name='总览')
```

## 一份常用速查

| 想做的事 | 写法 |
|---|---|
| 时间当索引 | `df.set_index('时间')` |
| 按时间重采样 | `df.resample('1min')` |
| 滚动平均 | `df['x'].rolling(50).mean()` |
| 换时间求差 | `s.diff(freq='5min')` |
| 按时间对齐两张表 | `pd.merge_asof(..., tolerance=...)` |
| 填缺失 | `df.interpolate()` / `df.ffill()` |
| 按小时分组 | `df.groupby(df['时间'].dt.hour)` |

## 两个容易翻车的点

**1. 别在原始 10Hz 数据上直接算差分求异常**

噪声会被放大。先 `rolling(5).mean()` 平滑，再算 `diff()`，误报会少一大半。

**2. 时间列一定要 `parse_dates`**

不转成 `datetime64` 的话，`resample`、`diff(freq=)`、`merge_asof` 全部不能用，报错信息还很隐晦。

---

数据分析的价值不在于画漂亮的图，而在于**把「感觉不太对」变成「这里有 37 个点超出 3σ，集中在 3:12–3:18，当时压缩机刚启动」**。`pandas` 就是干这个的。
