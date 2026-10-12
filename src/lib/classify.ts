/**
 * 分类推断
 *
 * 规则：优先用 frontmatter 里显式声明的 platform / category / difficulty，
 * 没写的就从 tags + 标题 + 摘要里推断，保证新文章不写元数据也能自动归类。
 */

export const PLATFORMS = ['STM32', 'ESP32', 'Linux', '树莓派', 'Arduino', '通用'];
export const CATEGORIES = ['传感器', '通信', '显示', '存储', '电源', '执行器', '工具', '随笔'];

export interface Classifiable {
  platform?: string;
  category?: string;
  difficulty?: string;
  tags?: string[];
  title: string;
  description?: string;
}

const PLATFORM_RULES: Array<[RegExp, string]> = [
  [/GD32|STM32/i, 'STM32'],
  [/ESP32|ESP8266/i, 'ESP32'],
  [/Linux|树莓派|Raspberry/i, 'Linux'],
  [/Arduino/i, 'Arduino'],
];

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/温度|湿度|传感器|MAX31865|PT100|AHT20|MPU6050|光照/i, '传感器'],
  [/物联网|MQTT|OneNET|LoRa|无线|WiFi|通信|蓝牙|串口/i, '通信'],
  [/显示|OLED|LCD|SSD1306|屏幕/i, '显示'],
  [/存储|Flash|W25Q|SD卡|EEPROM/i, '存储'],
  [/电源|稳压|DC-?DC|LDO|电池/i, '电源'],
  [/电机|舵机|步进|继电器/i, '执行器'],
  [/随笔|杂谈|开始|日记/i, '随笔'],
];

const BUS_RULES: Array<[RegExp, string]> = [
  [/MAX31865|SX1278|W25Q|SPI/i, 'SPI'],
  [/SSD1306|AHT20|MPU6050|OLED|I2C/i, 'I2C'],
  [/MQTT|OneNET|物联网/i, 'MQTT'],
  [/UART|串口/i, 'UART'],
];

function haystack(d: Classifiable): string {
  return [...(d.tags ?? []), d.title, d.description ?? ''].join(' ');
}

export function platformOf(d: Classifiable): string {
  if (d.platform) return d.platform;
  const hay = haystack(d);
  for (const [re, name] of PLATFORM_RULES) if (re.test(hay)) return name;
  return '通用';
}

export function categoryOf(d: Classifiable): string {
  if (d.category) return d.category;
  const hay = haystack(d);
  for (const [re, name] of CATEGORY_RULES) if (re.test(hay)) return name;
  return '随笔';
}

/** 通信接口：从标题和标签里认，认不出就标 NOTE */
export function busOf(d: Classifiable): string {
  const hay = haystack(d);
  for (const [re, label] of BUS_RULES) if (re.test(hay)) return label;
  return 'NOTE';
}

/** 颜色跟着类别走，同一类别永远同一个色，方便一眼认出来 */
export const CATEGORY_TINT: Record<string, string> = {
  传感器: 'tint-pink',
  通信: 'tint-blue',
  显示: 'tint-lavender',
  存储: 'tint-mint',
  电源: 'tint-amber',
  执行器: 'tint-pink',
  工具: 'tint-blue',
  随笔: 'tint-lavender',
};

export const tintOf = (category: string): string => CATEGORY_TINT[category] ?? 'tint-pink';

export const LEVEL_CLASS: Record<string, string> = {
  入门: 'level-begin',
  进阶: 'level-mid',
  硬核: 'level-hard',
};

export function shortDate(d: Date): string {
  const diff = Date.now() - d.valueOf();
  const day = 86400000;
  if (diff < day * 30) return `${Math.max(1, Math.round(diff / day))} 天前`;
  if (diff < day * 365) return `${Math.round(diff / (day * 30))} 个月前`;
  return d.toLocaleDateString('zh-CN');
}

/** 按固定顺序排列去重后的分类，未知的排到最后 */
const ORDER = {
  platform: PLATFORMS,
  category: CATEGORIES,
};

export function uniqBy(list: string[], kind: 'platform' | 'category'): string[] {
  const order = ORDER[kind];
  return [...new Set(list)].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
