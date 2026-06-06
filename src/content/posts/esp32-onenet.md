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

### 1. 硬件准备
- ESP32 开发板
- 杜邦线若干

### 2. 软件准备
- Arduino IDE
- 需要安装以下库：
  - PubSubClient
  - ArduinoJson
  - Ticker

### 3. OneNET 平台创建产品
1. 登录 [OneNET](https://open.iot.10086.cn/)
2. 创建产品，选择 MQTT 协议
3. 添加设备，记录 product_id、device_id 和 token

## 代码详解 {#代码详解}

### 1. 头文件和宏定义

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Ticker.h>
#include <ArduinoJson.h>

#define LED 2 //LED灯连接到GPIO2,用LED灯指示设备状态
```

这里引入了必要的库文件，`LED 2` 表示开发板上的指示灯 GPIO2。

### 2. OneNET 配置

```cpp
#define product_id "aGLGgWW0AG" //产品ID，改为自己的产品ID
#define device_id "LED" //设备ID，改为自己的设备ID
#define token "version=2018-10-31&res=products%2FaGLGgWW0AG%2Fdevices%2FLED&et=2058447118&method=md5&sign=8bE23XXVikhfzz%2BWDupxxg%3D%3D" //token
```

需要到 OneNET 平台获取你自己的 `product_id`、`device_id` 和 `token`。

### 3. WiFi 和 MQTT 配置

```cpp
const char* ssid = "HONOR";//WiFi名称
const char* password = "12345678";//WiFi密码

const char* mqtt_server = "mqtts.heclouds.com";//MQTT服务器地址
const int mqtt_port = 1883;//MQTT服务器端口
```

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
```

这些是 OneNET MQTT 的标准主题格式。

### 5. 变量定义

```cpp
int postMsgId = 0;//消息ID,每次上报属性时递增

float temp = 28.0;//温度
int humi = 60;//湿度
bool LED_Status = false;//LED状态

WiFiClient espClient;
PubSubClient client(espClient);
Ticker ticker;
```

### 6. setup() 初始化

```cpp
void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  WiFi_Connect();
  OneNet_Connect();
  ticker.attach(10, OneNet_Prop_Post);//每10秒上报一次属性
}
```

### 7. loop() 主循环

```cpp
void loop() {
  if(WiFi.status() != WL_CONNECTED) {
    WiFi_Connect();
  }
  if (!client.connected()) {
    OneNet_Connect();
  }
  client.loop();
}
```

检测连接状态，断线自动重连。

### 8. WiFi 连接函数

```cpp
void WiFi_Connect()
{
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    LED_Flash(500);
    Serial.println("\nConnecting to WiFi...");
  }
  Serial.println("Connected to the WiFi network");
  Serial.println(WiFi.localIP());
  digitalWrite(LED, HIGH);
}
```

### 9. OneNET 连接函数

```cpp
void OneNet_Connect()
{
  client.setServer(mqtt_server, mqtt_port);
  client.connect(device_id, product_id, token);
  if(client.connected()) 
  {
    LED_Flash(500);
    Serial.println("Connected to OneNet!");
  }
  else
  {
    Serial.println("Failed to connect to OneNet!");
  }
  client.subscribe(ONENET_TOPIC_PROP_SET);
  client.subscribe(ONENET_TOPIC_PROP_POST_REPLY);
  client.setCallback(callback);
}
```

### 10. 属性上报函数

```cpp
void OneNet_Prop_Post()
{
  humi+=1;
  if(humi==100) humi=0;
  if(client.connected()) 
  {
    char parmas[256];
    char jsonBuf[256];
    sprintf(parmas, "{\"Temp\":{\"value\":%.1f},\"Humi\":{\"value\":%d},\"LED\":{\"value\":%s}}", temp, humi, LED_Status ? "true" : "false");
    sprintf(jsonBuf,ONENET_TOPIC_PROP_FORMAT,postMsgId++,parmas);
    if(client.publish(ONENET_TOPIC_PROP_POST, jsonBuf))
    {
      LED_Flash(500);
      Serial.println("Post property success!");
    }
  }
}
```

### 11. 回调函数

```cpp
void callback(char* topic, byte* payload, unsigned int length)
{
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  LED_Flash(500);
  if(strcmp(topic, ONENET_TOPIC_PROP_SET) == 0)
  {
    DynamicJsonDocument doc(100);
    DeserializationError error = deserializeJson(doc, payload);
    if (error) {
      Serial.print(F("deserializeJson() failed: "));
      Serial.println(error.c_str());
      return;
    }
    JsonObject setAlinkMsgObj = doc.as<JsonObject>();
    JsonObject params = setAlinkMsgObj["params"];
    if(params.containsKey("LED"))
    {
      LED_Status = params["LED"];
      Serial.print("Set LED:");
      Serial.println(LED_Status);
    }
    // 发送响应
    String str = setAlinkMsgObj["id"];
    char SendBuf[100];
    sprintf(SendBuf, "{\"id\":\"%s\",\"code\":200,\"msg\":\"success\"}", str.c_str());
    client.publish(ONENET_TOPIC_PROP_SET_REPLY, SendBuf);
  }
}
```

## 完整代码 {#完整代码}

把上面的所有部分组合在一起，就是完整的代码：

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Ticker.h>
#include <ArduinoJson.h>

#define LED 2

#define product_id "aGLGgWW0AG"
#define device_id "LED"
#define token "version=2018-10-31&res=products%2FaGLGgWW0AG%2Fdevices%2FLED&et=2058447118&method=md5&sign=8bE23XXVikhfzz%2BWDupxxg%3D%3D"

const char* ssid = "HONOR";
const char* password = "12345678";

const char* mqtt_server = "mqtts.heclouds.com";
const int mqtt_port = 1883;

#define ONENET_TOPIC_PROP_POST "$sys/" product_id "/" device_id "/thing/property/post"
#define ONENET_TOPIC_PROP_SET "$sys/" product_id "/" device_id "/thing/property/set"
#define ONENET_TOPIC_PROP_POST_REPLY "$sys/" product_id "/" device_id "/thing/property/post/reply"
#define ONENET_TOPIC_PROP_SET_REPLY "$sys/" product_id "/" device_id "/thing/property/set_reply"
#define ONENET_TOPIC_PROP_FORMAT "{\"id\":\"%u\",\"version\":\"1.0\",\"params\":%s}"

int postMsgId = 0;

float temp = 28.0;
int humi = 60;
bool LED_Status = false;

WiFiClient espClient;
PubSubClient client(espClient);
Ticker ticker;

void LED_Flash(int time);
void WiFi_Connect();
void OneNet_Connect();
void OneNet_Prop_Post();
void callback(char* topic, byte* payload, unsigned int length);

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  WiFi_Connect();
  OneNet_Connect();
  ticker.attach(10, OneNet_Prop_Post);
}

void loop() {
  if(WiFi.status() != WL_CONNECTED) {
    WiFi_Connect();
  }
  if (!client.connected()) {
    OneNet_Connect();
  }
  client.loop();
}

void LED_Flash(int time) {
  digitalWrite(LED, HIGH);
  delay(time);
  digitalWrite(LED, LOW);
  delay(time);
}

void WiFi_Connect()
{
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    LED_Flash(500);
    Serial.println("\nConnecting to WiFi...");
  }
  Serial.println("Connected to the WiFi network");
  Serial.println(WiFi.localIP());
  digitalWrite(LED, HIGH);
}

void OneNet_Connect()
{
  client.setServer(mqtt_server, mqtt_port);
  client.connect(device_id, product_id, token);
  if(client.connected()) 
  {
    LED_Flash(500);
    Serial.println("Connected to OneNet!");
  }
  else
  {
    Serial.println("Failed to connect to OneNet!");
  }
  client.subscribe(ONENET_TOPIC_PROP_SET);
  client.subscribe(ONENET_TOPIC_PROP_POST_REPLY);
  client.setCallback(callback);
}

void OneNet_Prop_Post()
{
  humi+=1;
  if(humi==100) humi=0;
  if(client.connected()) 
  {
    char parmas[256];
    char jsonBuf[256];
    sprintf(parmas, "{\"Temp\":{\"value\":%.1f},\"Humi\":{\"value\":%d},\"LED\":{\"value\":%s}}", temp, humi, LED_Status ? "true" : "false");
    Serial.println(parmas);
    sprintf(jsonBuf,ONENET_TOPIC_PROP_FORMAT,postMsgId++,parmas);
    Serial.println(jsonBuf);
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

void callback(char* topic, byte* payload, unsigned int length)
{
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
  LED_Flash(500);
  if(strcmp(topic, ONENET_TOPIC_PROP_SET) == 0)
  {
    DynamicJsonDocument doc(100);
    DeserializationError error = deserializeJson(doc, payload);
    if (error) {
      Serial.print(F("deserializeJson() failed: "));
      Serial.println(error.c_str());
      return;
    }
    JsonObject setAlinkMsgObj = doc.as<JsonObject>();
    JsonObject params = setAlinkMsgObj["params"];
    if(params.containsKey("LED"))
    {
      LED_Status = params["LED"];
      Serial.print("Set LED:");
      Serial.println(LED_Status);
    }
    serializeJsonPretty(setAlinkMsgObj, Serial);
    String str = setAlinkMsgObj["id"];
    char SendBuf[100];
    sprintf(SendBuf, "{\"id\":\"%s\",\"code\":200,\"msg\":\"success\"}", str.c_str());
    Serial.println(SendBuf);
    delay(100);
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

## 使用说明 {#使用说明}

1. **修改配置**：把代码中的 `product_id`、`device_id`、`token`、`ssid`、`password` 改成你自己的
2. **上传代码**：用Arduino IDE把代码上传到ESP32
3. **查看结果**：打开串口监视器，波特率设为9600，可以看到连接日志
4. **OneNET平台**：在平台上可以看到上报的温湿度数据

## 注意事项 {#注意事项}

- 记得修改token时要按照OneNET的规则生成签名
- WiFi信息要改成你自己的
- LED引脚可以根据需要修改