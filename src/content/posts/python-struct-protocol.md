---
title: "用 struct 解析串口协议：从字节流到结构体"
description: "struct 的格式串怎么读、字节序怎么选、粘包半包怎么处理——把单片机发来的二进制帧稳定拆开"
pubDate: 2026-10-23
tags: ["Python", "struct", "协议解析", "串口", "字节序"]
platform: "通用"
category: "通信"
difficulty: "进阶"
---

单片机发来的不是文本，是一串字节。用 `decode()` 去解只会得到乱码——正确工具是 `struct`。

## struct 的格式串

```python
import struct

#  格式   C 类型          字节数
#  ----  --------------  ------
#  B     uint8_t         1
#  H     uint16_t        2
#  I     uint32_t        4
#  q     int64_t         8
#  f     float           4
#  d     double          8
#  c     char            1
#  s     char[]          变长
```

**大小写有含义**：小写是有符号，大写是无符号。`b` 是 `int8_t`，`B` 是 `uint8_t`。

字节序写在最前面：

| 前缀 | 含义 |
|---|---|
| `<` | 小端（STM32 / ESP32 默认） |
| `>` | 大端（网络序，Modbus 用这个） |
| `!` | 网络序（等价 `>`） |
| `=` | 本机序 |
| 不写 | 本机序 + 可能自动对齐（**最坑，永远别省略**） |

```python
struct.pack('<I', 0x12345678)   # b'\x78\x56\x34\x12'
struct.pack('>I', 0x12345678)   # b'\x12\x34\x56\x78'
```

## 解析一个真实帧

假设协议是：

| 字段 | 类型 | 说明 |
|---|---|---|
| head | uint8 | 固定 0xA5 |
| len | uint8 | 载荷长度 |
| id | uint16 | 设备 ID（小端） |
| value | uint32 | 数值（小端） |
| payload | bytes | 变长 |
| crc | uint8 | 前 N 字节的 CRC-8 |

```python
import struct
from dataclasses import dataclass

HEAD = 0xA5

@dataclass
class Frame:
    dev_id: int
    value: int
    payload: bytes


def parse_frame(buf: bytes) -> Frame | None:
    if len(buf) < 9:                      # 8 字节定长头 + 1 字节 crc
        return None
    head, plen = struct.unpack_from('<BB', buf, 0)
    if head != HEAD:
        raise ValueError(f'帧头错误: 0x{head:02X}')

    body_len = 4 + plen                   # id(2) + value(4)... 注意这里是 6
    total = 1 + 1 + 6 + plen + 1
    if len(buf) < total:
        return None                       # 还没收全

    dev_id, value = struct.unpack_from('<HI', buf, 2)
    payload = buf[8:8 + plen]
    crc = buf[8 + plen]

    if crc8(buf[:8 + plen]) != crc:
        raise ValueError('CRC 校验失败')

    return Frame(dev_id, value, payload)
```

几个要点：

- **用 `unpack_from(buf, offset)`**，比切片段更省内存
- **先检查长度再解包**，`struct` 不会帮你检查越界
- **定长头 + 变长尾**是最常见的协议形态，先拿到 `len` 再算总长

## 粘包与半包

串口是流式的，一次 `read()` 可能拿到：

- 半帧（数据还没发完）
- 一帧半
- 三帧半

**不能假设「一次读 = 一帧」**。标准做法是维护一个缓冲区：

```python
class FrameReader:
    def __init__(self):
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[Frame]:
        self.buf.extend(data)
        frames = []

        while True:
            # 1. 找帧头
            idx = self.buf.find(bytes([HEAD]))
            if idx < 0:
                self.buf.clear()          # 全是垃圾，丢掉
                break

            # 2. 丢弃帧头之前的杂字节（通信错误后的恢复）
            if idx > 0:
                del self.buf[:idx]

            # 3. 长度够吗？
            if len(self.buf) < 8:
                break                      # 等更多数据

            plen = self.buf[1]
            total = 9 + plen
            if len(self.buf) < total:
                break                      # 半包，等下批

            # 4. 试解
            try:
                f = parse_frame(bytes(self.buf[:total]))
            except ValueError:
                del self.buf[0]            # 校验失败，跳过这个帧头重新找
                continue

            frames.append(f)
            del self.buf[:total]

        return frames
```

关键点：

1. **缓冲区用 `bytearray`**，`del` 和 `extend` 都是原地操作，不产生新对象
2. **帧头错了要能恢复**：跳过这个头，继续找下一个
3. **校验失败只丢一个字节**，不能整段丢弃（可能只是这一个字节是偶然的 0xA5）
4. 缓冲区要有上限，否则一直收脏数据会吃满内存

## 打包回帧

发送方向反过来用 `pack`：

```python
def build_frame(dev_id: int, value: int, payload: bytes = b'') -> bytes:
    head = struct.pack('<BB', HEAD, len(payload))
    body = struct.pack('<HI', dev_id, value) + payload
    raw = head + body
    return raw + bytes([crc8(raw)])
```

注意 `struct.pack` 的返回值是 `bytes`，可以直接拼接。

## 对齐陷阱

```python
struct.calcsize('<BI')   # 5
struct.calcsize('BI')    # 8  ← 本机序会自动填充对齐！
```

不写字节序前缀时，`struct` 会像 C 编译器一样插入填充字节。**永远显式写 `<` 或 `>`**，这个坑太多人踩了。

## 浮点数

```python
struct.pack('<f', 3.14)          # b'\xc3\xf5H@'
struct.unpack('<f', b'\xc3\xf5H@')  # (3.140000104904175,)
```

精度损失是正常的：`float` 只有 7 位有效数字。需要高精度用 `<d`（8 字节 double）。

如果协议里是**定点数**（比如温度 × 100 存成 int16），千万别用 float 解：

```python
raw, = struct.unpack('<h', buf)
temperature = raw / 100.0
```

## 与其他工具的配合

`struct` 只管二进制转换，真实项目里通常还要：

```python
import csv
from serial import Serial

ser = Serial('COM5', 115200, timeout=0.1)
reader = FrameReader()

with open('frames.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['时间', '设备', '数值', '载荷'])

    while True:
        n = ser.in_waiting
        if not n:
            continue
        for fr in reader.feed(ser.read(n)):
            w.writerow([datetime.now().isoformat(timespec='milliseconds'),
                        fr.dev_id, fr.value, fr.payload.hex()])
            f.flush()
```

## 小结

`struct` 的要点就四条：

1. **格式串必须带字节序前缀**，`<` 小端 `>` 大端
2. **大小写区分有符号无符号**
3. **`unpack_from` + 偏移** 比切片高效
4. **协议解析一定要有缓冲区**，不能假设一次读一帧

写解析器时的心态应该是：**假设收到的每一个字节都可能是坏的**。帧头错了能重同步、CRC 错了能跳过、长度荒谬能丢弃——这三点做到了，解析器就基本不会崩。
