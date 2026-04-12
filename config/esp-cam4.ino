#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_http_server.h"

// ================= WIFI =================
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// ================= SERVER =================
const char* serverUrl = "http://YOUR_SERVER_IP:5000/upload";
const int uploadInterval = 10000; // Upload every 10 seconds

// ================= GLOBALS =================
httpd_handle_t stream_httpd = NULL;
unsigned long lastUploadTime = 0;
SemaphoreHandle_t frameMutex = NULL;
TaskHandle_t uploadTaskHandle = NULL;

// ================= LED CONTROL =================
#define LED_PIN 4  // Flash LED on GPIO 4 (ESP32-CAM)
bool ledState = false;

// ================= STREAM QUALITY =================
framesize_t currentFramesize = FRAMESIZE_QVGA;
int currentQuality = 12;


// ================= STREAM HANDLER =================
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

      size_t hlen = snprintf(part_buf, 64,
      "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
      fb->len);

      res = httpd_resp_send_chunk(req, part_buf, hlen);

      if(res == ESP_OK)
        res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);

      if(res == ESP_OK)
        res = httpd_resp_send_chunk(req, "\r\n--frame\r\n", 11);

      esp_camera_fb_return(fb);
    }

    if(res != ESP_OK) break;

    delay(1);
  }

  return res;
}


// ================= LED CONTROL HANDLER =================
static esp_err_t led_handler(httpd_req_t *req){
  
  char query[100];
  
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    char state[10];
    if (httpd_query_key_value(query, "state", state, sizeof(state)) == ESP_OK) {
      
      if (strcmp(state, "on") == 0) {
        digitalWrite(LED_PIN, HIGH);
        ledState = true;
        Serial.println("LED ON");
      } 
      else if (strcmp(state, "off") == 0) {
        digitalWrite(LED_PIN, LOW);
        ledState = false;
        Serial.println("LED OFF");
      }
      else if (strcmp(state, "toggle") == 0) {
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState ? HIGH : LOW);
        Serial.printf("LED %s\n", ledState ? "ON" : "OFF");
      }
      
      // Send JSON response
      httpd_resp_set_type(req, "application/json");
      char resp[50];
      snprintf(resp, sizeof(resp), "{\"led\":\"%s\"}", ledState ? "on" : "off");
      httpd_resp_send(req, resp, strlen(resp));
      return ESP_OK;
    }
  }
  
  // No state parameter or invalid request
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"error\":\"Invalid request\"}", 25);
  return ESP_FAIL;
}


// ================= QUALITY CONTROL HANDLER =================
static esp_err_t quality_handler(httpd_req_t *req){
  
  char query[200];
  sensor_t * s = esp_camera_sensor_get();
  
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    char resolution[20];
    char quality[10];
    
    bool updated = false;
    
    // Check for resolution parameter
    if (httpd_query_key_value(query, "resolution", resolution, sizeof(resolution)) == ESP_OK) {
      framesize_t newFramesize;
      
      if (strcmp(resolution, "QVGA") == 0) newFramesize = FRAMESIZE_QVGA;       // 320x240
      else if (strcmp(resolution, "VGA") == 0) newFramesize = FRAMESIZE_VGA;    // 640x480
      else if (strcmp(resolution, "SVGA") == 0) newFramesize = FRAMESIZE_SVGA;  // 800x600
      else if (strcmp(resolution, "XGA") == 0) newFramesize = FRAMESIZE_XGA;    // 1024x768
      else if (strcmp(resolution, "HD") == 0) newFramesize = FRAMESIZE_HD;      // 1280x720
      else if (strcmp(resolution, "SXGA") == 0) newFramesize = FRAMESIZE_SXGA;  // 1280x1024
      else if (strcmp(resolution, "UXGA") == 0) newFramesize = FRAMESIZE_UXGA;  // 1600x1200
      else {
        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, "{\"error\":\"Invalid resolution\"}", 30);
        return ESP_FAIL;
      }
      
      s->set_framesize(s, newFramesize);
      currentFramesize = newFramesize;
      updated = true;
      Serial.printf("Stream resolution changed to: %s\n", resolution);
    }
    
    // Check for quality parameter (0-63, lower is better)
    if (httpd_query_key_value(query, "quality", quality, sizeof(quality)) == ESP_OK) {
      int newQuality = atoi(quality);
      if (newQuality >= 0 && newQuality <= 63) {
        s->set_quality(s, newQuality);
        currentQuality = newQuality;
        updated = true;
        Serial.printf("Stream quality changed to: %d\n", newQuality);
      }
    }
    
    if (updated) {
      // Send current settings as JSON response
      httpd_resp_set_type(req, "application/json");
      char resp[200];
      const char* resName = "QVGA";
      switch(currentFramesize) {
        case FRAMESIZE_QVGA: resName = "QVGA"; break;
        case FRAMESIZE_VGA: resName = "VGA"; break;
        case FRAMESIZE_SVGA: resName = "SVGA"; break;
        case FRAMESIZE_XGA: resName = "XGA"; break;
        case FRAMESIZE_HD: resName = "HD"; break;
        case FRAMESIZE_SXGA: resName = "SXGA"; break;
        case FRAMESIZE_UXGA: resName = "UXGA"; break;
        default: resName = "UNKNOWN";
      }
      snprintf(resp, sizeof(resp), "{\"resolution\":\"%s\",\"quality\":%d}", resName, currentQuality);
      httpd_resp_send(req, resp, strlen(resp));
      return ESP_OK;
    }
  }
  
  // No parameters - return current settings
  httpd_resp_set_type(req, "application/json");
  char resp[200];
  const char* resName = "QVGA";
  switch(currentFramesize) {
    case FRAMESIZE_QVGA: resName = "QVGA"; break;
    case FRAMESIZE_VGA: resName = "VGA"; break;
    case FRAMESIZE_SVGA: resName = "SVGA"; break;
    case FRAMESIZE_XGA: resName = "XGA"; break;
    case FRAMESIZE_HD: resName = "HD"; break;
    case FRAMESIZE_SXGA: resName = "SXGA"; break;
    case FRAMESIZE_UXGA: resName = "UXGA"; break;
    default: resName = "UNKNOWN";
  }
  snprintf(resp, sizeof(resp), "{\"resolution\":\"%s\",\"quality\":%d}", resName, currentQuality);
  httpd_resp_send(req, resp, strlen(resp));
  return ESP_OK;
}


// ================= START STREAM =================
void startCameraServer(){

  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_uri_t stream_uri = {
    .uri = "/stream",
    .method = HTTP_GET,
    .handler = stream_handler,
    .user_ctx = NULL
  };

  httpd_uri_t led_uri = {
    .uri = "/led",
    .method = HTTP_GET,
    .handler = led_handler,
    .user_ctx = NULL
  };

  httpd_uri_t quality_uri = {
    .uri = "/quality",
    .method = HTTP_GET,
    .handler = quality_handler,
    .user_ctx = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK){
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &led_uri);
    httpd_register_uri_handler(stream_httpd, &quality_uri);
  }
}


// ================= CAPTURE HQ IMAGE (WITHOUT STOPPING STREAM) =================
camera_fb_t* captureHQImage(){
  sensor_t * s = esp_camera_sensor_get();
  
  // Take the mutex to safely change camera settings
  if(xSemaphoreTake(frameMutex, pdMS_TO_TICKS(1000)) == pdTRUE){
    
    // Store current stream settings
    framesize_t savedFramesize = currentFramesize;
    int savedQuality = currentQuality;
    
    // Flush existing frames
    for(int i = 0; i < 2; i++) {
      camera_fb_t * fb = esp_camera_fb_get();
      if(fb) esp_camera_fb_return(fb);
    }
    
    // Switch to high resolution temporarily
    s->set_framesize(s, FRAMESIZE_UXGA);
    s->set_quality(s, 10);
    
    // Wait for sensor stabilization
    delay(1000); // Adjust as needed based on your lighting conditions
    
    // Capture HQ image
    camera_fb_t * fb = esp_camera_fb_get();
    
    // Restore user's chosen stream settings
    s->set_framesize(s, savedFramesize);
    s->set_quality(s, savedQuality);
    
    xSemaphoreGive(frameMutex);
    
    return fb;
  }
  
  return NULL;
}


// ================= UPLOAD TASK (RUNS IN PARALLEL) =================
void uploadTask(void * parameter){
  
  while(true){
    
    // Wait for the interval
    vTaskDelay(pdMS_TO_TICKS(uploadInterval));
    
    Serial.println("Capturing HQ image (stream continues)...");
    
    camera_fb_t * fb = captureHQImage();
    
    if (!fb){
      Serial.println("HQ capture failed");
      continue;
    }
    
    Serial.printf("Image captured! Size: %zu bytes\n", fb->len);
    Serial.println("Uploading image...");
    
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "image/jpeg");
    http.setTimeout(10000); // 10 second timeout
    
    int response = http.POST(fb->buf, fb->len);
    
    Serial.print("Upload response: ");
    Serial.println(response);
    
    http.end();
    esp_camera_fb_return(fb);
  }
}

// ================= CAMERA INIT =================
void initCamera(){
  camera_config_t config;

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  // Pin Mapping
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

  // Clock speed - 20MHz is standard, but 10MHz is more stable for high-res
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // CRITICAL: Initialize with the MAXIMUM resolution you plan to use
  // This ensures the DMA buffer is large enough for UXGA captures.
  if(psramFound()){
    config.frame_size = FRAMESIZE_UXGA; 
    config.jpeg_quality = 10;
    config.fb_count = 2; // Keep at 2 for smoother streaming if PSRAM is present
    config.grab_mode = CAMERA_GRAB_LATEST; // Ensures you don't get old frames
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  // Camera init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK){
    Serial.printf("Camera init failed 0x%x\n", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  
  // Now drop the resolution back down to QVGA for the initial stream
  s->set_framesize(s, FRAMESIZE_QVGA);
  s->set_quality(s, 12);
  
  // Store initial settings
  currentFramesize = FRAMESIZE_QVGA;
  currentQuality = 12;

  // Sensor fine-tuning
  s->set_brightness(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_exposure_ctrl(s, 1);
}

// ================= SETUP =================
void setup(){

  Serial.begin(115200);

  // Initialize LED pin
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Create mutex for thread-safe camera access
  frameMutex = xSemaphoreCreateMutex();

  initCamera();

  WiFi.begin(ssid, password);

  Serial.print("Connecting");

  while (WiFi.status() != WL_CONNECTED){
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");

  Serial.print("Stream URL: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/stream");

  startCameraServer();
  
  // Start the upload task on Core 0 (Core 1 handles WiFi/HTTP)
  xTaskCreatePinnedToCore(
    uploadTask,           // Task function
    "UploadTask",         // Name
    10000,                // Stack size (bytes)
    NULL,                 // Parameter
    1,                    // Priority
    &uploadTaskHandle,    // Task handle
    0                     // Core 0
  );
  
  Serial.println("Upload task started - stream will continue during uploads");
}


// ================= LOOP =================
void loop(){
  // Upload task runs in background automatically
  // You can add other non-blocking code here if needed
  delay(1000);
}