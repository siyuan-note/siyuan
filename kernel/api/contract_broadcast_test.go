package api

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIContractBroadcastMultipart(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, text := range []string{" first ", "second"} {
		if err := writer.WriteField("contract-multipart", text); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"first.txt", "second.txt"} {
		file, err := writer.CreateFormFile("contract-multipart", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte("abc")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/broadcast/publish", broadcastPublish)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/broadcast/publish", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/broadcast/publish", recorder)
	var response struct {
		Code int                              `json:"code"`
		Data apicontract.BroadcastPublishData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 0 || len(response.Data.Results) != 4 {
		t.Fatalf("lost multipart entries: %s", recorder.Body.String())
	}
	for i, result := range response.Data.Results {
		if result.Channel.Name != "contract-multipart" || result.Code != 0 {
			t.Fatalf("invalid result: %#v", result)
		}
		if i < 2 && (result.Message.Type != "string" || result.Message.Size != []int{7, 6}[i]) {
			t.Fatalf("text changed: %#v", result.Message)
		}
		if i >= 2 && (result.Message.Type != "binary" || result.Message.Size != 3 || result.Message.Filename != []string{"first.txt", "second.txt"}[i-2]) {
			t.Fatalf("file changed: %#v", result.Message)
		}
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/broadcast/publish", strings.NewReader("invalid")))
	requireAPIContract(t, "POST", "/api/broadcast/publish", recorder)
	if !strings.Contains(recorder.Body.String(), `"code":1`) {
		t.Fatalf("multipart error code changed: %s", recorder.Body.String())
	}
}

func TestAPIContractBroadcastChannels(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/broadcast/getChannelInfo", getChannelInfo)
	engine.POST("/api/broadcast/getChannels", getChannels)
	engine.POST("/api/broadcast/postMessage", postMessage)
	for _, entry := range []struct{ path, body string }{
		{"/api/broadcast/getChannelInfo", `{"name":"  contract-absent  "}`},
		{"/api/broadcast/postMessage", `{"channel":"  contract-absent  ","message":" hello "}`},
		{"/api/broadcast/getChannels", `{`},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", entry.path, recorder)
		var response struct {
			Code int `json:"code"`
			Data struct {
				Channel *ChannelInfo `json:"channel"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("unexpected channel response: %s, %v", recorder.Body.String(), err)
		}
		if entry.path != "/api/broadcast/getChannels" && (response.Data.Channel == nil || response.Data.Channel.Name != "contract-absent" || response.Data.Channel.Count != 0) {
			t.Fatalf("channel changed: %s", recorder.Body.String())
		}
	}
}
