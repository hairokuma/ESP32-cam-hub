#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_task_wdt.h>
#include "esp_http_server.h"
#include "credentials.h"  // WiFi credentials (not committed to git)

// ============= CONFIGURATION =============
const unsigned long UPLOAD_INTERVAL_MS = 10000;
const framesize_t CAMERA_FRAMESIZE = FRAMESIZE_XGA;
const int CAMERA_QUALITY = 12;
#define LED_PIN 4

// Optional motion sensor: digital output that goes HIGH on motion, e.g. HC-SR501 PIR
// (OUT -> GPIO 13, VCC -> 5V) or RCWL-0516 radar. GPIO 13 is free on the AI-Thinker board.
// Leave at -1 for cameras without a sensor; set it here, in credentials.h or as a build flag
// (-DMOTION_PIN=13) for cameras that have one.
#ifndef MOTION_PIN
#define MOTION_PIN -1
#endif
const bool HAS_MOTION_SENSOR = MOTION_PIN >= 0;
const unsigned long MOTION_INTERVAL_MS = 2000;   // upload interval while motion is detected
const unsigned long MOTION_WARMUP_MS = 60000;    // PIR output is unreliable right after power-up

// Self-recovery: reconnect or restart instead of hanging until someone power-cycles the camera
const unsigned long WIFI_BOOT_TIMEOUT_MS = 60000;       // restart if WiFi doesn't connect at boot
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 30000; // retry while disconnected
const unsigned long WIFI_RESTART_AFTER_MS = 300000;     // restart after 5 minutes without WiFi
const int MAX_UPLOAD_FAILURES = 30;                     // ~5 minutes at the normal upload interval
const int MAX_CAPTURE_FAILURES = 10;
const int WATCHDOG_TIMEOUT_S = 60;                      // upload task hung (e.g. stuck in a socket call)

// ============= GLOBALS =============
httpd_handle_t stream_httpd = NULL;
SemaphoreHandle_t frameMutex = NULL;
TaskHandle_t uploadTaskHandle = NULL;
bool ledState = false;

// Survives ESP.restart() so the next boot can report why we restarted ourselves
RTC_NOINIT_ATTR char restartCause[32];
String bootReason;


// ============= RESTART / DIAGNOSTICS =============
void restartWith(const char* cause){
  Serial.printf("Restarting: %s\n", cause);
  strlcpy(restartCause, cause, sizeof(restartCause));
  delay(100);
  ESP.restart();
}

const char* resetReasonName(esp_reset_reason_t reason){
  switch(reason){
    case ESP_RST_POWERON:   return "poweron";
    case ESP_RST_EXT:       return "external";
    case ESP_RST_SW:        return "software";
    case ESP_RST_PANIC:     return "panic";
    case ESP_RST_INT_WDT:   return "int_watchdog";
    case ESP_RST_TASK_WDT:  return "task_watchdog";
    case ESP_RST_WDT:       return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT:  return "brownout";
    default:                return "unknown";
  }
}

// e.g. "brownout", "panic" or "software:wifi_lost"
String readBootReason(){
  esp_reset_reason_t reason = esp_reset_reason();
  String result = resetReasonName(reason);
  if (reason == ESP_RST_SW){
    restartCause[sizeof(restartCause) - 1] = '\0';
    if (restartCause[0]) result += String(":") + restartCause;
  }
  restartCause[0] = '\0';
  return result;
}

void initWatchdog(){
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t config = {
    .timeout_ms = WATCHDOG_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_reconfigure(&config);
#else
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
#endif
}


// ============= CAPTURE IMAGE =============
// Stream and upload run in different tasks; serialize access to the camera driver
camera_fb_t* captureImage(){
  if(xSemaphoreTake(frameMutex, pdMS_TO_TICKS(1000)) == pdTRUE){
    camera_fb_t * fb = esp_camera_fb_get();
    xSemaphoreGive(frameMutex);
    return fb;
  }
  return NULL;
}


// ============= STREAM HANDLER =============
static esp_err_t stream_handler(httpd_req_t *req){
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[64];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
  if(res != ESP_OK) return res;

  while(true){
    fb = captureImage();
    if (!fb){
      Serial.println("Stream capture failed");
      res = ESP_FAIL;
    }
    else{
      size_t hlen = snprintf(part_buf, 64, "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
      if(res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
      if(res == ESP_OK) res = httpd_resp_send_chunk(req, "\r\n--frame\r\n", 11);
      esp_camera_fb_return(fb);
    }
    if(res != ESP_OK) break;
    delay(1);
  }
  return res;
}


// ============= LED CONTROL HANDLER =============
static esp_err_t led_handler(httpd_req_t *req){
  char query[100];

  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    char state[10];
    if (httpd_query_key_value(query, "state", state, sizeof(state)) == ESP_OK) {
      if (strcmp(state, "on") == 0) {
        ledState = true;
        Serial.println("LED ON");
      }
      else if (strcmp(state, "off") == 0) {
        ledState = false;
        Serial.println("LED OFF");
      }
      else if (strcmp(state, "toggle") == 0) {
        ledState = !ledState;
        Serial.printf("LED %s\n", ledState ? "ON" : "OFF");
      }
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);

      httpd_resp_set_type(req, "application/json");
      char resp[50];
      snprintf(resp, sizeof(resp), "{\"led\":\"%s\"}", ledState ? "on" : "off");
      httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
      return ESP_OK;
    }
  }

  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"error\":\"Invalid request\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_FAIL;
}


// ============= START CAMERA SERVER =============
void startCameraServer(){
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.lru_purge_enable = true;  // drop the oldest connection instead of refusing new ones

  httpd_uri_t stream_uri = {.uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL};
  httpd_uri_t led_uri = {.uri = "/led", .method = HTTP_GET, .handler = led_handler, .user_ctx = NULL};

  if (httpd_start(&stream_httpd, &config) == ESP_OK){
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &led_uri);
  }
}


// ============= MOTION SENSOR =============
// Without a sensor (MOTION_PIN -1) this always returns false and no interrupt is attached
bool motionDetected(){
#if MOTION_PIN >= 0
  return millis() > MOTION_WARMUP_MS && digitalRead(MOTION_PIN) == HIGH;
#else
  return false;
#endif
}

// Wake the upload task so the first motion image is taken right away
void IRAM_ATTR onMotion(){
  BaseType_t woken = pdFALSE;
  if (uploadTaskHandle) vTaskNotifyGiveFromISR(uploadTaskHandle, &woken);
  portYIELD_FROM_ISR(woken);
}


// ============= UPLOAD TASK =============
void uploadTask(void * parameter){
  int uploadFailures = 0;
  int captureFailures = 0;
  unsigned long lastUpload = 0;
  esp_task_wdt_add(NULL);

  while(true){
    esp_task_wdt_reset();

    // Upload every UPLOAD_INTERVAL_MS, or every MOTION_INTERVAL_MS while motion is detected.
    // The motion interrupt ends the wait early so the interval is re-evaluated immediately.
    bool motion = motionDetected();
    unsigned long interval = motion ? MOTION_INTERVAL_MS : UPLOAD_INTERVAL_MS;
    unsigned long elapsed = millis() - lastUpload;
    if (elapsed < interval){
      ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(interval - elapsed));
      continue;
    }
    lastUpload = millis();

    // WiFi outages are handled in loop(); don't count them as upload failures
    if (WiFi.status() != WL_CONNECTED) continue;

    camera_fb_t * fb = captureImage();
    if (!fb){
      Serial.println("Capture failed");
      if (++captureFailures >= MAX_CAPTURE_FAILURES) restartWith("capture_failed");
      continue;
    }
    captureFailures = 0;

    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("X-RSSI", String(WiFi.RSSI()));
    http.addHeader("X-Free-Heap", String(ESP.getFreeHeap()));
    http.addHeader("X-Min-Free-Heap", String(ESP.getMinFreeHeap()));
    http.addHeader("X-Uptime", String(millis() / 1000));
    http.addHeader("X-Reset-Reason", bootReason);
    if (HAS_MOTION_SENSOR) http.addHeader("X-Motion-Sensor", "1");  // lets the hub show motion info
    if (motion) http.addHeader("X-Motion", "1");
    http.setTimeout(10000);

    int response = http.POST(fb->buf, fb->len);
    http.end();
    esp_camera_fb_return(fb);

    if (response == 200){
      uploadFailures = 0;
    } else {
      Serial.printf("Upload failed (%d), %d in a row\n", response, uploadFailures + 1);
      if (++uploadFailures >= MAX_UPLOAD_FAILURES) restartWith("upload_failed");
    }
  }
}


// ============= CAMERA INIT =============
void initCamera(){
  camera_config_t config = {};  // zero all fields the driver reads but we don't set
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 5;
  config.pin_d1 = 18;
  config.pin_d2 = 19;
  config.pin_d3 = 21;
  config.pin_d4 = 36;
  config.pin_d5 = 39;
  config.pin_d6 = 34;
  config.pin_d7 = 35;
  config.pin_xclk = 0;
  config.pin_pclk = 22;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_sccb_sda = 26;
  config.pin_sccb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = CAMERA_FRAMESIZE;
  config.jpeg_quality = CAMERA_QUALITY;
  config.fb_count = psramFound() ? 2 : 1;
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK){
    Serial.printf("Camera init failed 0x%x\n", err);
    delay(5000);
    restartWith("camera_init_failed");
  }

  sensor_t * s = esp_camera_sensor_get();
  s->set_brightness(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_exposure_ctrl(s, 1);
}


// ============= WIFI =============
void connectWiFi(){
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep causes dropouts and stream stalls on the ESP32-CAM
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);

  Serial.print("Connecting");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED){
    if (millis() - start > WIFI_BOOT_TIMEOUT_MS) restartWith("wifi_boot_timeout");
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi connected, RSSI %d dBm\n", WiFi.RSSI());
}

// Called from loop(): reconnect periodically, restart if WiFi stays down
void checkWiFi(){
  static unsigned long disconnectedSince = 0;
  static unsigned long lastReconnect = 0;
  unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED){
    if (disconnectedSince) Serial.printf("WiFi reconnected after %lus\n", (now - disconnectedSince) / 1000);
    disconnectedSince = 0;
    return;
  }

  if (!disconnectedSince){
    Serial.println("WiFi lost");
    disconnectedSince = now;
    lastReconnect = now;
  }
  if (now - disconnectedSince > WIFI_RESTART_AFTER_MS){
    restartWith("wifi_lost");
  }
  if (now - lastReconnect > WIFI_RECONNECT_INTERVAL_MS){
    Serial.println("Reconnecting WiFi...");
    WiFi.reconnect();
    lastReconnect = now;
  }
}


// ============= SETUP =============
void setup(){
  Serial.begin(115200);
  bootReason = readBootReason();
  Serial.printf("Boot reason: %s\n", bootReason.c_str());

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  frameMutex = xSemaphoreCreateMutex();
  initCamera();
  connectWiFi();
  Serial.printf("Stream URL: http://%s/stream\n", WiFi.localIP().toString().c_str());

  startCameraServer();
  initWatchdog();

  xTaskCreatePinnedToCore(uploadTask, "UploadTask", 10000, NULL, 1, &uploadTaskHandle, 0);
  Serial.println("Upload task started");

#if MOTION_PIN >= 0
  pinMode(MOTION_PIN, INPUT_PULLDOWN);  // stays LOW if the sensor is disconnected
  attachInterrupt(digitalPinToInterrupt(MOTION_PIN), onMotion, RISING);
  Serial.printf("Motion sensor on GPIO %d\n", MOTION_PIN);
#endif
}

// ============= LOOP =============
void loop(){
  checkWiFi();
  delay(1000);
}
