---
title: "ESP32连接OneNET物联网平台"
description: "使用ESP32连接OneNET物联网平台，MQTT协议上报温湿度数据"
pubDate: 2026-06-06
tags: ["ESP32", "物联网", "OneNET", "MQTT"]
---

# ESP32 连接 OneNET 物联网平台

今天来教大家如何使用 ESP32 连接 OneNET 物联网平台，通过 MQTT 协议上报温湿度数据~

## 准备工作 {#准备工作}

### 1. 硬件准备

| 硬件名称 | 推荐型号 | 用途 |
|---------|---------|------|
| ESP32 开发板 | ESP32-WROOM-32 | 核心控制单元，WiFi/BLE双模 |
| USB 数据线 | Type-C | 供电和程序下载 |
| 杜邦线若干 | 公对公/公对母 | 连接传感器（可选） |
| DHT11/DHT22（可选） | 温湿度传感器 | 实际采集温湿度数据 |

> **推荐开发板**：ESP32 DevKitC，性价比高，资料丰富，适合初学者。

### 2. 软件准备

- **Arduino IDE** - 官方下载地址：[https://www.arduino.cc/en/software](https://www.arduino.cc/en/software)
- **ESP32 开发板支持** - 在 Arduino IDE 中添加 ESP32 开发板管理器
- **所需库文件**：
  - **PubSubClient** - MQTT 客户端库
  - **ArduinoJson** - JSON 数据处理库
  - **Ticker** - 定时器库（用于定时上报）
  - **DHT sensor library** - DHT 传感器驱动（如果使用实际传感器）

**安装库的方法**：
1. 打开 Arduino IDE
2. 点击 `工具` -> `管理库`
3. 在搜索框中输入库名，点击安装

### 3. OneNET 平台注册与产品创建

**步骤 1：注册账号**
1. 访问 [OneNET 官方网站](https://open.iot.10086.cn/)
2. 点击右上角"登录/注册"
3. 使用手机号注册并完成实名认证

**步骤 2：创建产品**
1. 登录后进入控制台
2. 点击"产品管理" -> "添加产品"
3. 填写产品信息：
   - 产品名称：自定义（如 "ESP32温湿度采集"）
   - 产品类型：选择 "智能硬件"
   - 联网方式：选择 "WiFi"
   - 数据协议：选择 "MQTT"
   - 设备接入协议：选择 "标准MQTT"
4. 点击"确定"创建产品

**步骤 3：添加设备**
1. 进入刚创建的产品详情页
2. 点击"设备管理" -> "添加设备"
3. 填写设备名称（如 "ESP32_001"）
4. 点击"确定"创建设备

**步骤 4：获取认证信息**
1. 在设备列表中找到刚创建的设备
2. 点击设备进入详情页
3. 记录以下信息：
   - **Product ID**（产品ID）
   - **Device ID**（设备ID）
   - **Token**（设备密钥，需要手动生成）

**步骤 5：添加物模型**（重要！）
1. 在产品详情页点击"物模型"
2. 点击"添加属性"
3. 添加以下属性：
   - 温度（Temp）：浮点型，单位°C
   - 湿度（Humi）：整型，单位%
   - LED状态（LED）：布尔型

## 工作原理 {#代码详解}

### MQTT 协议简介

MQTT（Message Queuing Telemetry Transport）是一种轻量级的消息传输协议，专为物联网设备设计。

**MQTT 核心概念：**
- **Broker**：消息代理服务器（OneNET 平台）
- **Client**：客户端（ESP32 设备）
- **Topic**：消息主题，用于消息分类
- **Publish**：发布消息
- **Subscribe**：订阅消息
- **QoS**：服务质量等级（0/1/2）

**OneNET MQTT 特点：**
- 支持标准 MQTT 3.1.1 协议
- 设备通过 Token 认证
- 提供物模型接口，支持属性上报和命令下发

### OneNET MQTT 主题说明

OneNET 使用固定格式的主题进行设备通信：

| 主题类型 | 格式 | 说明 |
|---------|------|------|
| 属性上报 | `$sys/{product_id}/{device_id}/thing/property/post` | 设备向平台上报属性 |
| 属性设置 | `$sys/{product_id}/{device_id}/thing/property/set` | 平台向设备下发属性设置命令 |
| 属性上报响应 | `$sys/{product_id}/{device_id}/thing/property/post/reply` | 平台对上报的响应 |
| 属性设置响应 | `$sys/{product_id}/{device_id}/thing/property/set_reply` | 设备对设置命令的响应 |

### 代码结构说明

```cpp
├── 头文件引入
├── 宏定义（LED引脚、产品信息）
├── WiFi和MQTT配置
├── MQTT主题定义
├── 全局变量声明
├── 函数声明
├── setup() - 初始化
├── loop() - 主循环
├── WiFi_Connect() - WiFi连接
├── OneNet_Connect() - MQTT连接
├── OneNet_Prop_Post() - 属性上报
├── callback() - MQTT消息回调
└── LED_Flash() - LED闪烁辅助函数
```

## 代码详解

### 1. 头文件和宏定义

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Ticker.h>
#include <ArduinoJson.h>

#define LED 2 //LED灯连接到GPIO2,用LED灯指示设备状态
```

**代码说明：**
- `Arduino.h` - Arduino 核心库
- `WiFi.h` - ESP32 WiFi 驱动库
- `PubSubClient.h` - MQTT 客户端库
- `Ticker.h` - 非阻塞定时器库
- `ArduinoJson.h` - JSON 解析和生成库

### 2. OneNET 配置

```cpp
#define product_id "aGLGgWW0AG" //产品ID，改为自己的产品ID
#define device_id "LED" //设备ID，改为自己的设备ID
#define token "version=2018-10-31&res=products%2FaGLGgWW0AG%2Fdevices%2FLED&et=2058447118&method=md5&sign=8bE23XXVikhfzz%2BWDupxxg%3D%3D" //token
```

**获取方式：**
- `product_id`：产品详情页获取
- `device_id`：设备详情页获取
- `token`：设备详情页点击"获取Token"生成

### 3. WiFi 和 MQTT 配置

```cpp
const char* ssid = "HONOR";//WiFi名称
const char* password = "12345678";//WiFi密码

const char* mqtt_server = "mqtts.heclouds.com";//MQTT服务器地址
const int mqtt_port = 1883;//MQTT服务器端口
```

**OneNET MQTT 服务器信息：**
- **标准端口**：1883（TCP）
- **加密端口**：8883（SSL/TLS）
- **服务器地址**：`mqtts.heclouds.com`

### 4. MQTT 主题定义

```cpp
#define ONENET_TOPIC_PROP_POST "$sys/" product_id "/" device_id "/thing/property/post"
//设备属性上报请求,设备---->OneNET
#define ONENET_TOPIC_PROP_SET "$sys/" product_id "/" device_id "/thing/property/set"
//设备属性设置请求,OneNET---->设备
#define ONENET_TOPIC_PROP_POST_REPLY "$sys/" product_id "/" device_id "/thing/property/post/reply"
//设备属性上报响应,OneNET---->设备
#define ONENET_TOPIC_PROP_SET_REPLY "$sys/" product_id "/" device_id "/thing/property/set_reply"
//设备属性设置响应,设备---->OneNET
#define ONENET_TOPIC_PROP_FORMAT "{\"id\":\"%u\",\"version\":\"1.0\",\"params\":%s}"
//属性上报消息格式
```

**消息格式说明：**
```json
{
  "id": "123",
  "version": "1.0",
  "params": {
    "Temp": {"value": 28.5},
    "Humi": {"value": 60},
    "LED": {"value": true}
  }
}
```

### 5. 变量定义

```cpp
int postMsgId = 0;//消息ID,每次上报属性时递增

float temp = 28.0;//温度模拟值
int humi = 60;//湿度模拟值
bool LED_Status = false;//LED状态

WiFiClient espClient;
PubSubClient client(espClient);
Ticker ticker;
```

**变量说明：**
- `postMsgId`：消息ID，用于消息追踪和去重
- `temp/humi`：温湿度数据（实际项目中应从传感器读取）
- `LED_Status`：LED 开关状态
- `espClient`：WiFi 客户端实例
- `client`：MQTT 客户端实例
- `ticker`：定时器实例，用于定时上报

### 6. setup() 初始化

```cpp
void setup() {
  pinMode(LED, OUTPUT);         // 配置LED引脚为输出
  Serial.begin(9600);           // 初始化串口，波特率9600
  WiFi_Connect();               // 连接WiFi
  OneNet_Connect();             // 连接OneNET
  ticker.attach(10, OneNet_Prop_Post); // 每10秒上报一次属性
}
```

**初始化流程：**
1. 配置 LED 引脚为输出模式
2. 初始化串口通信（用于调试）
3. 连接 WiFi 网络
4. 连接 OneNET MQTT 服务器
5. 设置定时任务（每10秒上报一次）

### 7. loop() 主循环

```cpp
void loop() {
  // 检测WiFi连接状态
  if(WiFi.status() != WL_CONNECTED) {
    WiFi_Connect();
  }
  // 检测MQTT连接状态
  if (!client.connected()) {
    OneNet_Connect();
  }
  // 处理MQTT消息
  client.loop();
}
```

**主循环逻辑：**
- 持续检测 WiFi 连接，断开自动重连
- 持续检测 MQTT 连接，断开自动重连
- 调用 `client.loop()` 处理 MQTT 消息（必须定期调用）

### 8. WiFi 连接函数

```cpp
void WiFi_Connect()
{
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    LED_Flash(500);
    Serial.println("\nConnecting to WiFi...");
    delay(1000);
  }
  Serial.println("Connected to the WiFi network");
  Serial.println("IP Address: " + WiFi.localIP().toString());
  digitalWrite(LED, HIGH);
}
```

**连接流程：**
1. 调用 `WiFi.begin()` 开始连接
2. 循环等待连接成功（LED 闪烁指示）
3. 连接成功后打印 IP 地址
4. LED 常亮表示连接成功

### 9. OneNET 连接函数

```cpp
void OneNet_Connect()
{
  client.setServer(mqtt_server, mqtt_port);
  
  // 连接MQTT服务器，参数：clientId, username, password
  if(client.connect(device_id, product_id, token)) 
  {
    LED_Flash(500);
    Serial.println("Connected to OneNet!");
    
    // 订阅属性设置主题
    client.subscribe(ONENET_TOPIC_PROP_SET);
    // 订阅属性上报响应主题
    client.subscribe(ONENET_TOPIC_PROP_POST_REPLY);
    // 设置消息回调函数
    client.setCallback(callback);
  }
  else
  {
    Serial.println("Failed to connect to OneNet!");
    Serial.println("MQTT Connect Error: " + String(client.state()));
    delay(5000); // 失败后延时5秒再重试
  }
}
```

**MQTT 连接参数：**
- **clientId**：设备ID（device_id）
- **username**：产品ID（product_id）
- **password**：设备Token

**订阅主题说明：**
- `ONENET_TOPIC_PROP_SET`：接收平台下发的属性设置命令
- `ONENET_TOPIC_PROP_POST_REPLY`：接收平台对属性上报的响应

### 10. 属性上报函数

```cpp
void OneNet_Prop_Post()
{
  // 模拟温湿度变化（实际项目中从传感器读取）
  humi++;
  if(humi >= 100) humi = 30;
  
  if(client.connected()) 
  {
    char params[256];
    char jsonBuf[256];
    
    // 构建属性JSON
    sprintf(params, "{\"Temp\":{\"value\":%.1f},\"Humi\":{\"value\":%d},\"LED\":{\"value\":%s}}", 
            temp, humi, LED_Status ? "true" : "false");
    
    // 构建完整上报消息
    sprintf(jsonBuf, ONENET_TOPIC_PROP_FORMAT, postMsgId++, params);
    
    Serial.println("上报数据: " + String(jsonBuf));
    
    // 发布消息
    if(client.publish(ONENET_TOPIC_PROP_POST, jsonBuf))
    {
      LED_Flash(500);
      Serial.println("Post property success!");
    }
    else
    {
      Serial.println("Post property failed!");
    }
  }
}
```

**上报流程：**
1. 更新模拟数据（实际项目中读取传感器）
2. 构建 JSON 格式的属性数据
3. 组装完整的上报消息（包含消息ID）
4. 调用 `client.publish()` 发布消息
5. 根据返回值判断是否成功

### 11. 回调函数

```cpp
void callback(char* topic, byte* payload, unsigned int length)
{
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  
  // 打印收到的消息内容
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
  
  LED_Flash(500);
  
  // 判断是否是属性设置命令
  if(strcmp(topic, ONENET_TOPIC_PROP_SET) == 0)
  {
    // 解析JSON消息
    DynamicJsonDocument doc(512);
    DeserializationError error = deserializeJson(doc, payload, length);
    
    if (error) {
      Serial.print(F("deserializeJson() failed: "));
      Serial.println(error.c_str());
      return;
    }
    
    // 获取消息ID和参数
    String msgId = doc["id"].as<String>();
    JsonObject params = doc["params"];
    
    // 处理LED属性设置
    if(params.containsKey("LED"))
    {
      LED_Status = params["LED"].as<bool>();
      digitalWrite(LED, LED_Status ? HIGH : LOW);
      Serial.print("LED Status Changed: ");
      Serial.println(LED_Status ? "ON" : "OFF");
    }
    
    // 发送响应消息
    char SendBuf[100];
    sprintf(SendBuf, "{\"id\":\"%s\",\"code\":200,\"msg\":\"success\"}", msgId.c_str());
    
    if(client.publish(ONENET_TOPIC_PROP_SET_REPLY, SendBuf))
    {
      Serial.println("Send set reply success!");
    }
    else
    {
      Serial.println("Send set reply failed!");
    }
  }
}
```

**回调函数说明：**
1. 接收 MQTT 消息时自动调用
2. 解析消息内容（JSON 格式）
3. 根据主题类型处理不同消息
4. 处理属性设置命令并控制硬件
5. 返回响应给平台

## 完整代码 {#完整代码}

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Ticker.h>
#include <ArduinoJson.h>

// 硬件配置
#define LED 2

// OneNET配置 - 请修改为你自己的信息
#define product_id "aGLGgWW0AG"
#define device_id "LED"
#define token "version=2018-10-31&res=products%2FaGLGgWW0AG%2Fdevices%2FLED&et=2058447118&method=md5&sign=8bE23XXVikhfzz%2BWDupxxg%3D%3D"

// WiFi配置
const char* ssid = "HONOR";
const char* password = "12345678";

// MQTT配置
const char* mqtt_server = "mqtts.heclouds.com";
const int mqtt_port = 1883;

// MQTT主题定义
#define ONENET_TOPIC_PROP_POST "$sys/" product_id "/" device_id "/thing/property/post"
#define ONENET_TOPIC_PROP_SET "$sys/" product_id "/" device_id "/thing/property/set"
#define ONENET_TOPIC_PROP_POST_REPLY "$sys/" product_id "/" device_id "/thing/property/post/reply"
#define ONENET_TOPIC_PROP_SET_REPLY "$sys/" product_id "/" device_id "/thing/property/set_reply"
#define ONENET_TOPIC_PROP_FORMAT "{\"id\":\"%u\",\"version\":\"1.0\",\"params\":%s}"

// 全局变量
int postMsgId = 0;
float temp = 28.0;
int humi = 60;
bool LED_Status = false;

// 对象实例
WiFiClient espClient;
PubSubClient client(espClient);
Ticker ticker;

// 函数声明
void LED_Flash(int time);
void WiFi_Connect();
void OneNet_Connect();
void OneNet_Prop_Post();
void callback(char* topic, byte* payload, unsigned int length);

void setup() {
  pinMode(LED, OUTPUT);
  digitalWrite(LED, LOW);
  
  Serial.begin(9600);
  while (!Serial); // 等待串口连接
  
  Serial.println("\n=== ESP32 OneNET MQTT Demo ===");
  
  WiFi_Connect();
  OneNet_Connect();
  
  // 设置定时上报（每10秒）
  ticker.attach(10, OneNet_Prop_Post);
}

void loop() {
  // WiFi重连
  if(WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    WiFi_Connect();
  }
  
  // MQTT重连
  if (!client.connected()) {
    Serial.println("MQTT disconnected, reconnecting...");
    OneNet_Connect();
  }
  
  // 处理MQTT消息
  client.loop();
  
  delay(100);
}

void LED_Flash(int time) {
  digitalWrite(LED, HIGH);
  delay(time);
  digitalWrite(LED, LOW);
  delay(time);
}

void WiFi_Connect() {
  WiFi.begin(ssid, password);
  
  int retry = 0;
  const int maxRetry = 20;
  
  while (WiFi.status() != WL_CONNECTED && retry < maxRetry) {
    LED_Flash(500);
    Serial.println("Connecting to WiFi... (" + String(retry + 1) + "/" + String(maxRetry) + ")");
    retry++;
    delay(1000);
  }
  
  if(WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi Connected!");
    Serial.println("IP Address: " + WiFi.localIP().toString());
    digitalWrite(LED, HIGH);
  } else {
    Serial.println("WiFi Connection Failed!");
    while(1) {
      LED_Flash(200); // 快速闪烁表示错误
    }
  }
}

void OneNet_Connect() {
  client.setServer(mqtt_server, mqtt_port);
  
  // 设置连接超时
  client.setConnectionTimeout(10);
  
  if(client.connect(device_id, product_id, token)) {
    LED_Flash(500);
    Serial.println("Connected to OneNET!");
    
    // 订阅主题
    client.subscribe(ONENET_TOPIC_PROP_SET);
    client.subscribe(ONENET_TOPIC_PROP_POST_REPLY);
    
    // 设置回调函数
    client.setCallback(callback);
    
    Serial.println("Subscribed to topics");
  } else {
    Serial.println("OneNET Connection Failed!");
    Serial.println("Error Code: " + String(client.state()));
    delay(5000);
  }
}

void OneNet_Prop_Post() {
  // 模拟数据变化
  humi++;
  if(humi >= 100) humi = 30;
  
  if(client.connected()) {
    char params[256];
    char jsonBuf[256];
    
    sprintf(params, "{\"Temp\":{\"value\":%.1f},\"Humi\":{\"value\":%d},\"LED\":{\"value\":%s}}",
            temp, humi, LED_Status ? "true" : "false");
    
    sprintf(jsonBuf, ONENET_TOPIC_PROP_FORMAT, postMsgId++, params);
    
    Serial.println("\n上报数据:");
    Serial.println(jsonBuf);
    
    if(client.publish(ONENET_TOPIC_PROP_POST, jsonBuf)) {
      LED_Flash(200);
      Serial.println("上报成功!");
    } else {
      Serial.println("上报失败!");
    }
  } else {
    Serial.println("MQTT未连接，跳过上报");
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("\n收到消息 [");
  Serial.print(topic);
  Serial.print("]: ");
  
  // 打印原始消息
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
  
  LED_Flash(200);
  
  if(strcmp(topic, ONENET_TOPIC_PROP_SET) == 0) {
    DynamicJsonDocument doc(512);
    DeserializationError error = deserializeJson(doc, payload, length);
    
    if (error) {
      Serial.print("JSON解析失败: ");
      Serial.println(error.c_str());
      return;
    }
    
    String msgId = doc["id"].as<String>();
    JsonObject params = doc["params"];
    
    // 处理LED控制
    if(params.containsKey("LED")) {
      LED_Status = params["LED"].as<bool>();
      digitalWrite(LED, LED_Status ? HIGH : LOW);
      Serial.print("LED状态已更新: ");
      Serial.println(LED_Status ? "开启" : "关闭");
    }
    
    // 处理温度设置（如果需要）
    if(params.containsKey("Temp")) {
      temp = params["Temp"].as<float>();
      Serial.print("温度已更新: ");
      Serial.println(temp);
    }
    
    // 发送响应
    char SendBuf[100];
    sprintf(SendBuf, "{\"id\":\"%s\",\"code\":200,\"msg\":\"success\"}", msgId.c_str());
    
    if(client.publish(ONENET_TOPIC_PROP_SET_REPLY, SendBuf)) {
      Serial.println("响应发送成功");
    } else {
      Serial.println("响应发送失败");
    }
  }
  
  // 处理上报响应
  if(strcmp(topic, ONENET_TOPIC_PROP_POST_REPLY) == 0) {
    // 可以在这里处理平台的响应，比如检查上报是否成功
    Serial.println("收到上报响应");
  }
}
```

## 添加实际传感器支持

如果你有 DHT11 或 DHT22 传感器，可以使用以下代码读取实际温湿度：

### 接线方式

| DHT11/DHT22 | ESP32 |
|------------|-------|
| VCC | 3.3V |
| GND | GND |
| DATA | GPIO4 |

### 修改代码

```cpp
#include <DHT.h>

// 添加传感器定义
#define DHTPIN 4
#define DHTTYPE DHT11 // 或 DHT22

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  // ... 其他初始化 ...
  dht.begin();
}

void OneNet_Prop_Post() {
  // 读取实际传感器数据
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  
  // 检查读取是否成功
  if (isnan(h) || isnan(t)) {
    Serial.println("读取传感器失败!");
    return;
  }
  
  // 使用读取到的数据
  temp = t;
  humi = (int)h;
  
  // ... 后续上报代码 ...
}
```

## 使用说明 {#使用说明}

### 1. 修改配置信息

将代码中的以下内容修改为你自己的信息：

```cpp
#define product_id "你的产品ID"
#define device_id "你的设备ID"
#define token "你的设备Token"

const char* ssid = "你的WiFi名称";
const char* password = "你的WiFi密码";
```

### 2. 上传代码

1. 连接 ESP32 开发板到电脑
2. 在 Arduino IDE 中选择正确的开发板和端口
3. 点击"上传"按钮

### 3. 查看调试信息

1. 打开串口监视器（波特率9600）
2. 观察连接过程和数据上报
3. 检查是否有错误信息

### 4. 在 OneNET 平台查看数据

1. 登录 OneNET 控制台
2. 进入产品详情页
3. 点击"设备管理" -> 选择设备
4. 点击"数据流"查看上报的温湿度数据
5. 在"远程控制"中可以下发 LED 控制命令

## 常见问题及解决方法 {#注意事项}

| 问题现象 | 可能原因 | 解决方法 |
|---------|---------|---------|
| WiFi 连接失败 | WiFi名称或密码错误 | 检查 WiFi 配置 |
| MQTT 连接失败 | product_id/device_id/token 错误 | 确认设备认证信息 |
| 数据上报失败 | 物模型未配置 | 在平台添加对应的属性 |
| 接收不到命令 | 未订阅主题或订阅失败 | 检查订阅代码 |
| Token 失效 | Token 过期 | 在平台重新生成 Token |
| 网络不稳定 | WiFi 信号弱 | 靠近路由器或使用信号增强器 |

**MQTT 连接错误码说明：**
- **-4**：连接超时
- **-3**：服务器不可达
- **-2**：协议错误
- **-1**：客户端断开
- **0**：连接成功

## 扩展功能建议

1. **添加更多传感器**：支持光照、气压、空气质量等传感器
2. **OTA 固件升级**：使用 OneNET 的 OTA 功能远程升级固件
3. **数据存储**：将历史数据存储到 SD 卡或云端
4. **低功耗模式**：使用 ESP32 的深度睡眠功能延长电池寿命
5. **本地显示**：连接 OLED 显示屏实时显示数据
6. **告警功能**：当数据超过阈值时发送告警通知

---

希望这篇文章对你有帮助！如果有任何问题或建议，欢迎留言讨论~

*Happy Coding! 🚀*
