#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_http_server.h"

// ============= CONFIGURATION =============
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://YOUR_SERVER_IP:5000/upload";
const int uploadInterval = 10000;
const framesize_t CAMERA_FRAMESIZE = FRAMESIZE_XGA;
const int CAMERA_QUALITY = 12;
#define LED_PIN 4

// ============= GLOBALS =============
httpd_handle_t stream_httpd = NULL;
SemaphoreHandle_t frameMutex = NULL;
TaskHandle_t uploadTaskHandle = NULL;
bool ledState = false;


// ============= STREAM HANDLER =============
static esp_err_t stream_handler(httpd_req_t *req){
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[64];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
  if(res != ESP_OK) return res;

  while(true){
    fb = esp_camera_fb_get();
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
      httpd_resp_send(req, resp, strlen(resp));
      return ESP_OK;
    }
  }
  
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"error\":\"Invalid request\"}", 25);
  return ESP_FAIL;
}


// ============= START CAMERA SERVER =============
void startCameraServer(){
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_uri_t stream_uri = {.uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL};
  httpd_uri_t led_uri = {.uri = "/led", .method = HTTP_GET, .handler = led_handler, .user_ctx = NULL};

  if (httpd_start(&stream_httpd, &config) == ESP_OK){
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &led_uri);
  }
}

// ============= CAPTURE IMAGE =============
camera_fb_t* captureImage(){
  if(xSemaphoreTake(frameMutex, pdMS_TO_TICKS(1000)) == pdTRUE){
    camera_fb_t * fb = esp_camera_fb_get();
    xSemaphoreGive(frameMutex);
    return fb;
  }
  return NULL;
}


// ============= UPLOAD TASK =============
void uploadTask(void * parameter){
  while(true){
    vTaskDelay(pdMS_TO_TICKS(uploadInterval));
    
    Serial.println("Capturing image...");
    camera_fb_t * fb = captureImage();
    
    if (!fb){
      Serial.println("Capture failed");
      continue;
    }
    
    Serial.printf("Captured %zu bytes, uploading...\n", fb->len);
    
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "image/jpeg");
    http.setTimeout(10000);
    
    int response = http.POST(fb->buf, fb->len);
    Serial.printf("Upload response: %d\n", response);
    
    http.end();
    esp_camera_fb_return(fb);
  }
}

// ============= CAMERA INIT =============
void initCamera(){
  camera_config_t config;
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
  config.pin_sscb_sda = 26;
  config.pin_sscb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = CAMERA_FRAMESIZE;
  config.jpeg_quality = CAMERA_QUALITY;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK){
    Serial.printf("Camera init failed 0x%x\n", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  s->set_brightness(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_exposure_ctrl(s, 1);
}

// ============= SETUP =============
void setup(){
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  frameMutex = xSemaphoreCreateMutex();
  initCamera();

  WiFi.begin(ssid, password);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED){
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nWiFi connected");
  Serial.printf("Stream URL: http://%s/stream\n", WiFi.localIP().toString().c_str());

  startCameraServer();
  
  xTaskCreatePinnedToCore(uploadTask, "UploadTask", 10000, NULL, 1, &uploadTaskHandle, 0);
  Serial.println("Upload task started");
}

// ============= LOOP =============
void loop(){
  delay(1000);
}