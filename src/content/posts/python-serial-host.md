---
title: "用 pyserial 写一个串口上位机：从收数据到存 CSV"
description: "20 行代码跑通串口收发，逐行解析、非阻塞读取、自动记录 CSV——嵌入式调试最实用的一段 Python"
pubDate: 2026-10-23
tags: ["Python", "pyserial", "串口", "上位机", "数据采集"]
platform: "通用"
category: "通信"
difficulty: "入门"
---

浏览器里的 Web Serial 够用，但要做长时间记录、批量分析、接进其他脚本时，Python 更顺手。这篇把串口上位机的骨架搭完。

## 装依赖

```bash
pip install pyserial
```

注意包名是 `pyserial`，但导入时写 `import serial`。

## 第一步：找到你的串口

别手写 `COM3`，插拔一次编号就可能变。让 pyserial 自己列：

```python
from serial.tools import list_ports

for p in list_ports.comports():
    print(f"{p.device:<12} {p.description}  (VID:PID={p.vid:04X}:{p.pid:04X})" if p.vid else f"{p.device:<12} {p.description}")
```

输出大概是这样：

```text
COM5         USB-SERIAL CH340 (COM5)  (VID:PID=1A86:7523)
COM1         Communications Port (COM1)
```

`VID:PID` 很有用——靠它能在脚本里锁定「我的板子」，而不依赖 COM 号：

```python
def find_board(vid=0x1A86, pid=0x7523):
    for p in list_ports.comports():
        if p.vid == vid and p.pid == pid:
            return p.device
    raise RuntimeError("没找到 CH340，检查线是不是只供电不通信")
```

## 第二步：打开、收发

```python
import serial
import time

ser = serial.Serial(
    port="COM5",
    baudrate=115200,
    bytesize=8,
    parity="N",
    stopbits=1,
    timeout=0.1,        # 读超时：没有数据就等 0.1 秒然后返回
)

time.sleep(2)           # ⚠️ 很多板子打开串口会复位，等它启动完

ser.write(b"AT\r\n")    # 注意是 bytes，不是 str
time.sleep(0.2)

print(ser.read(ser.in_waiting or 1))

ser.close()
```

三个容易踩的点：

1. **`timeout` 别设成 `None`**。设成 `None` 表示「一直等」，主循环会卡死。给个 0.1 秒，配合 `in_waiting` 判断。
2. **开串口常会触发复位**。Arduino/ESP32 的 DTR 会拉低 EN，板子重启，前 1–2 秒的数据是 boot log，不是你的回复。
3. **写入必须是 `bytes`**。字符串要先 `encode()`。

## 第三步：非阻塞读——别用 `readline()` 死等

`serial.readline()` 在没收到换行符时会一直阻塞到超时。设备输出不带 `\n` 时就很难受。

更稳的写法是「有空就读一点，攒在缓冲里自己切行」：

```python
class LineReader:
    def __init__(self, ser):
        self.ser = ser
        self.buf = b""

    def poll(self):
        """返回本次读到的所有完整行（str 列表）"""
        n = self.ser.in_waiting
        if n:
            self.buf += self.ser.read(n)

        lines = []
        while b"\n" in self.buf:
            raw, self.buf = self.buf.split(b"\n", 1)
            line = raw.rstrip(b"\r").decode("utf-8", errors="replace")
            lines.append(line)
        return lines
```

用起来：

```python
reader = LineReader(ser)
while True:
    for line in reader.poll():
        print(line)
    time.sleep(0.01)
```

**为什么自己切行而不是 `readline()`**：

- 能一次处理多行，不会漏
- 半行数据留在缓冲区，下次拼接（避免把一帧切断）
- `errors="replace"` 防止某个坏字节让整个程序抛异常

## 第四步：解析并记录 CSV

假设板子按 `温度,湿度` 的格式发数据：

```python
import csv
import datetime

def parse(line):
    """'25.6,48.2' -> (25.6, 48.2)；格式不对返回 None"""
    parts = line.split(",")
    if len(parts) != 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


with open("sensor_log.csv", "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.writer(f)
    writer.writerow(["时间", "温度", "湿度"])

    reader = LineReader(ser)
    while True:
        for line in reader.poll():
            data = parse(line)
            if data is None:
                continue                        # boot log、OK 之类的直接跳过
            ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            writer.writerow([ts, data[0], data[1]])
            f.flush()                           # ⚠️ 关键：立刻落盘
```

两个细节：

- **`flush()`**：不调用的话数据攒在缓冲区里，程序被 Ctrl+C 杀掉时最后几十行会丢
- **`encoding="utf-8-sig"`**：带 BOM，Excel 打开中文表头才不会乱码

## 第五步：加个简单的命令行参数

```python
import argparse

ap = argparse.ArgumentParser(description="串口记录器")
ap.add_argument("-p", "--port", default=None, help="串口，比如 COM5；不填自动找 CH340")
ap.add_argument("-b", "--baud", type=int, default=115200)
ap.add_argument("-o", "--out", default="sensor_log.csv")
ap.add_argument("--seconds", type=float, default=0, help="记录时长，0 表示一直记")
args = ap.parse_args()

port = args.port or find_board()
```

这样一行命令就能跑：

```bash
python logger.py -b 115200 -o test.csv --seconds 60
```

## 完整骨架

```python
#!/usr/bin/env python3
"""串口数据记录器：自动找板子、逐行解析、写 CSV"""

import argparse
import csv
import datetime
import sys
import time

import serial
from serial.tools import list_ports


def find_board():
    for p in list_ports.comports():
        if p.vid == 0x1A86:          # CH340
            return p.device
    raise RuntimeError("没找到 CH340 设备")


class LineReader:
    def __init__(self, ser):
        self.ser, self.buf = ser, b""

    def poll(self):
        n = self.ser.in_waiting
        if n:
            self.buf += self.ser.read(n)
        out = []
        while b"\n" in self.buf:
            raw, self.buf = self.buf.split(b"\n", 1)
            out.append(raw.rstrip(b"\r").decode("utf-8", "replace"))
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-p", "--port")
    ap.add_argument("-b", "--baud", type=int, default=115200)
    ap.add_argument("-o", "--out", default="sensor_log.csv")
    ap.add_argument("--seconds", type=float, default=0)
    args = ap.parse_args()

    port = args.port or find_board()
    ser = serial.Serial(port, args.baud, timeout=0.1)
    time.sleep(2)                     # 等板子复位完成
    ser.reset_input_buffer()

    reader = LineReader(ser)
    t0 = time.time()
    rows = 0

    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["时间", "原始行"])

        try:
            while True:
                if args.seconds and time.time() - t0 > args.seconds:
                    break
                for line in reader.poll():
                    if not line:
                        continue
                    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    w.writerow([ts, line])
                    f.flush()
                    rows += 1
                    print(f"\r{rows} 行  {line[:40]:<40}", end="")
                time.sleep(0.01)
        except KeyboardInterrupt:
            pass

    ser.close()
    print(f"\n已保存 {rows} 行到 {args.out}")


if __name__ == "__main__":
    main()
```

## 常见问题对照

| 现象 | 原因 | 解决 |
|---|---|---|
| `SerialException: could not open port` | 端口被占用（串口助手没关） | 关掉其他串口软件 |
| 收到一堆乱码 | 波特率不对 | 试 9600 / 115200 |
| 只能收到第一个字节 | 没循环读 | 用 `in_waiting` + 循环 |
| 数据被截断 | 用 `read()` 直接读，切断了帧 | 缓冲 + 按 `\n` 切 |
| Ctrl+C 后丢最后几行 | 没 `flush()` | 每写一行就 flush |
| 中文乱码 | 编码不对 | 设备端 UTF-8，或 `errors="replace"` |

---

这套骨架改几行就能变成：自动烧录脚本、产线测试工装、传感器老化记录。核心就三件事——**正确打开端口、非阻塞地攒行、及时落盘**。
