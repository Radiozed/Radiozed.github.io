---
title: "用 Python 批量烧录 ESP32：产线脚本怎么写"
description: "esptool 的命令行参数、自动识别板子、读取 MAC 打标签、失败重试——把「点十几次鼠标」变成一条命令"
pubDate: 2026-10-23
tags: ["Python", "esptool", "ESP32", "烧录", "自动化"]
platform: "ESP32"
category: "工具"
difficulty: "进阶"
---

烧一块板子用 Arduino IDE 点两下就行。烧二十块、还要记下每块的 MAC 地址呢？

这篇把批量烧录的脚本骨架搭完。

## esptool 基础

```bash
pip install esptool
```

最常用的几条命令：

```bash
# 看芯片信息（型号、MAC、Flash 大小、晶振）
esptool.py --port COM5 chip_id

# 擦除整片 Flash
esptool.py --port COM5 erase_flash

# 烧一个固件到 0x0
esptool.py --port COM5 --baud 921600 write_flash 0x0 firmware.bin

# 多段烧录（bootloader / 分区表 / app）
esptool.py --port COM5 --baud 921600 write_flash \
  0x1000  bootloader.bin \
  0x8000  partitions.bin \
  0x10000 app.bin
```

ESP32 的默认分区偏移要记牢：`bootloader@0x1000`、`partition-table@0x8000`、`app@0x10000`。
ESP32-S3 / C3 的 bootloader 在 `0x0`，不一样，别混。

## 自动找板子

硬编码 `COM5` 在产线上不现实——换个 USB 口就变了。用 `esptool` 自带的探测：

```python
import subprocess
import sys
from serial.tools import list_ports

def find_esp_ports() -> list[str]:
    """返回所有像 ESP 的串口"""
    found = []
    for p in list_ports.comports():
        # CH340 / CP210x / FTDI + ESP32-S3 原生 USB
        if p.vid in (0x1A86, 0x10C4, 0x0403, 0x303A):
            found.append(p.device)
    return found
```

`0x303A` 是乐鑫自己的 VID（ESP32-S2/S3/C3 的原生 USB-JTAG）。

更稳的做法是**真的去问芯片**：

```python
def is_esp(port: str) -> bool:
    try:
        r = subprocess.run(
            [sys.executable, '-m', 'esptool', '--port', port, '--connect-attempts', '2', 'chip_id'],
            capture_output=True, text=True, timeout=15,
        )
        return 'Chip is ESP' in r.stdout
    except subprocess.TimeoutExpired:
        return False
```

优点是不会误判（比如插了个 Arduino Uno 也带 CH340）。

## 读 MAC 并打标签

每块板子出库前要记 MAC，方便日后追溯：

```python
import re

def read_mac(port: str) -> str | None:
    r = subprocess.run(
        [sys.executable, '-m', 'esptool', '--port', port, 'chip_id'],
        capture_output=True, text=True, timeout=20,
    )
    m = re.search(r'MAC:\s*([0-9a-fA-F:]{17})', r.stdout)
    return m.group(1).lower() if m else None
```

拿到 MAC 后可以生成设备序列号，甚至**写进固件**做唯一标识：

```python
def mac_to_serial(mac: str) -> str:
    tail = mac.replace(':', '').upper()[-6:]   # 取后 6 位
    return f'SKZ-{tail}'
```

## 批量主流程

```python
import csv
import time
from datetime import datetime
from pathlib import Path

FIRMWARE = [
    (0x1000,  'bootloader.bin'),
    (0x8000,  'partitions.bin'),
    (0x10000, 'app.bin'),
]
BAUD = 921600
RETRY = 2

def flash_one(port: str) -> dict:
    result = {'port': port, 'mac': None, 'serial': None,
              'ok': False, 'msg': '', 'ts': datetime.now().isoformat(timespec='seconds')}

    mac = read_mac(port)
    if not mac:
        result['msg'] = '读不到 MAC（不是 ESP 或没进下载模式）'
        return result
    result['mac'] = mac
    result['serial'] = mac_to_serial(mac)

    cmd = [sys.executable, '-m', 'esptool',
           '--port', port, '--baud', str(BAUD),
           '--before', 'default_reset', '--after', 'hard_reset',
           'write_flash', '--verify']
    for addr, path in FIRMWARE:
        cmd += [hex(addr), str(Path(path).resolve())]

    for attempt in range(1, RETRY + 1):
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        out = r.stdout + r.stderr
        if r.returncode == 0 and 'Hash of data verified' in out:
            result['ok'] = True
            result['msg'] = f'成功（第 {attempt} 次）'
            return result
        result['msg'] = f'第 {attempt} 次失败: ' + out.strip().splitlines()[-1][:120]
        time.sleep(1.5)

    return result


def main():
    ports = find_esp_ports()
    if not ports:
        print('没找到 ESP 设备')
        return

    print(f'发现 {len(ports)} 个串口: {ports}')
    rows = []
    for i, port in enumerate(ports, 1):
        print(f'[{i}/{len(ports)}] {port} ...', end=' ', flush=True)
        r = flash_one(port)
        rows.append(r)
        print('✅' if r['ok'] else '❌', r['msg'])

    with open('flash_report.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    ok = sum(1 for r in rows if r['ok'])
    print(f'\n完成 {ok}/{len(rows)}，报告已写入 flash_report.csv')


if __name__ == '__main__':
    main()
```

跑完得到一个 CSV：

```csv
port,mac,serial,ok,msg,ts
COM5,24:6f:28:a1:b2:c3,SKZ-A1B2C3,True,成功（第 1 次）,2026-10-23T23:20:11
COM7,24:6f:28:a1:b2:d4,SKZ-A1B2D4,True,成功（第 2 次）,2026-10-23T23:20:48
COM9,,,False,读不到 MAC（不是 ESP 或没进下载模式）,2026-10-23T23:21:02
```

## 几个实战细节

### 1. 串口必须先释放

如果之前用串口助手连过，esptool 会报 `Failed to connect`。脚本里可以先尝试打开再关闭：

```python
import serial
def release_port(port: str):
    try:
        s = serial.Serial(port, 115200)
        s.close()
    except Exception:
        pass
```

### 2. 波特率不是越高越好

921600 很快，但对 USB 线材和板子的 USB-Serial 芯片质量敏感。量产时如果偶发失败，先降到 460800 试。

### 3. 供电

一块 USB Hub 带 4 块 ESP32 同时烧录，电流可能不够，表现为随机失败。**分批烧，或者用带外部供电的 Hub**。

### 4. 并行烧录

`esptool` 是单进程的，但可以并行跑多个（每块板子一个进程）：

```python
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=4) as ex:
    results = list(ex.map(flash_one, ports))
```

⚠️ 前提是每块板子独立供电、独立 USB 通道。同一个 Hub 上并联四块，供电和 USB 带宽都会成为瓶颈。

### 5. 让板子自动进下载模式

多数开发板有自动复位电路（DTR/RTS 控制 EN 和 GPIO0），`--before default_reset` 就能自动进入。
但裸模组（比如自己画的板子）没有这个电路，需要手动按 BOOT 再复位 —— 这种就得做**夹具**或者在板上留按键。

## 小结

批量烧录脚本的价值不在「省几次点击」，而在于：

- **一致性**：每块板子烧的固件、偏移完全一样
- **可追溯**：MAC / 序列号 / 时间戳自动记录
- **可判定**：`--verify` 校验通过才算出厂，不靠人眼

产线上再往前一步就是做成 GUI 或者扫码枪联动，但核心逻辑就是上面这一百来行。
