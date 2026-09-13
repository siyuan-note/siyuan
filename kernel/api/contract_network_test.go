package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestAPIContractNetworkEventSourceLifecycle(t *testing.T) {
	bundle := networkTestBundle(t)
	finished := make(chan struct{})
	payload := ": keepalive\nevent: upstream-custom\nid: 7\ndata: not JSON\n\n"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(finished)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(409)
		_, _ = io.WriteString(w, payload)
		_ = http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}))
	defer upstream.Close()
	engine := gin.New()
	engine.GET("/es/network/proxy", esProxy)
	server := httptest.NewServer(engine)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/es/network/proxy?u="+base64.RawURLEncoding.EncodeToString([]byte(upstream.URL)), nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	actual := make([]byte, len(payload))
	if _, err = io.ReadFull(response.Body, actual); err != nil || string(actual) != payload {
		t.Fatalf("event bytes changed: %q %v", actual, err)
	}
	if response.StatusCode != 409 {
		t.Fatal("upstream event status changed")
	}
	if err = bundle.ValidateHTTPResponse("GET", "/es/network/proxy", response.StatusCode, response.Header.Get("Content-Type"), actual); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream stream survived request cancellation")
	}
}

func networkTestBundle(t *testing.T) *apicontract.Bundle {
	t.Helper()
	b, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAPIContractNetworkEcho(t *testing.T) {
	bundle := networkTestBundle(t)
	engine := gin.New()
	engine.Any("/api/network/echo", echo)
	engine.Any("/api/network/echo/*path", echoPath)
	raw := []byte{0, 1, 255}
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"} {
		request := httptest.NewRequest(method, "/api/network/echo/a?q=1&q=2", bytes.NewReader(raw))
		request.SetBasicAuth("user", "pass")
		request.AddCookie(&http.Cookie{Name: "x", Value: "y"})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if err := bundle.ValidateHTTPResponse(method, "/api/network/echo/*path", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var response struct {
			Data struct {
				Context struct {
					RawData string
					Params  []apicontract.NetworkEchoParam
				}
				User    apicontract.NetworkEchoUser
				Request struct {
					Method  string
					TLS     json.RawMessage
					Cookies []http.Cookie
				}
			}
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Data.Context.RawData != base64.StdEncoding.EncodeToString(raw) || response.Data.Request.Method != method || response.Data.User.Password != "pass" || response.Data.Context.Params[0].Value != "/a" || string(response.Data.Request.TLS) != "null" {
			t.Fatalf("echo changed: %s", recorder.Body.String())
		}
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("field", "value")
	part, _ := writer.CreateFormFile("file", "raw.bin")
	_, _ = part.Write(raw)
	_ = writer.Close()
	request := httptest.NewRequest("POST", "/api/network/echo", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if err := bundle.ValidateHTTPResponse("POST", "/api/network/echo", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data struct {
			Context struct{ RawData string }
			Request struct {
				MultipartForm apicontract.NetworkEchoMultipart
			}
		}
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	if response.Data.Context.RawData != "" || response.Data.Request.MultipartForm.File["file"][0].Content != base64.StdEncoding.EncodeToString(raw) {
		t.Fatalf("multipart changed: %s", recorder.Body.String())
	}
}

func TestAPIContractNetworkForwardPayload(t *testing.T) {
	bundle := networkTestBundle(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		w.Header().Set("X-Seen-Method", r.Method)
		w.Header().Set("X-Seen-Header", r.Header.Get("X-Value"))
		w.WriteHeader(418)
		_, _ = w.Write(data)
	}))
	defer upstream.Close()
	engine := gin.New()
	engine.POST("/api/network/forwardProxy", forwardProxy)
	for _, tt := range []struct{ payload, encoding, want string }{
		{`"raw string"`, "json", "raw string"}, {`123`, "json", "123"}, {`{"a":true}`, "json", `{"a":true}`}, {`null`, "json", ""}, {`"ignored"`, "text", ""}, {`"AAH/"`, "base64", string([]byte{0, 1, 255})}, {`"6162"`, "hex", "ab"},
	} {
		body := `{"url":` + strconv.Quote(upstream.URL) + `,"method":"put","payload":` + tt.payload + `,"payloadEncoding":` + strconv.Quote(tt.encoding) + `,"responseEncoding":"base64","headers":[null,1,{"X-Value":[1,true]}]}`
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/network/forwardProxy", strings.NewReader(body)))
		if err := bundle.ValidateHTTPResponse("POST", "/api/network/forwardProxy", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var result struct {
			Code int
			Data apicontract.NetworkForwardData
		}
		_ = json.Unmarshal(recorder.Body.Bytes(), &result)
		if result.Code != 0 || result.Data.Status != 418 || result.Data.Body != base64.StdEncoding.EncodeToString([]byte(tt.want)) || result.Data.Headers["X-Seen-Method"][0] != "PUT" || result.Data.Headers["X-Seen-Header"][0] != "[1 true]" {
			t.Fatalf("payload %s changed: %s", tt.payload, recorder.Body.String())
		}
	}
	for _, tt := range []struct {
		body string
		code int
	}{{`{"url":"invalid","method":3}`, 1}, {`{"url":"ftp://example.com","timeout":"bad"}`, 2}, {`{"url":` + strconv.Quote(upstream.URL) + `,"payloadEncoding":"hex","payload":"x"}`, 7}} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/network/forwardProxy", strings.NewReader(tt.body)))
		var result struct{ Code int }
		_ = json.Unmarshal(recorder.Body.Bytes(), &result)
		if result.Code != tt.code {
			t.Fatalf("validation order changed: %s", recorder.Body.String())
		}
	}
}

func TestAPIContractNetworkProxyWire(t *testing.T) {
	bundle := networkTestBundle(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, _ := strconv.Atoi(r.URL.Query().Get("status"))
		w.Header().Set("Content-Type", "text/html")
		w.Header().Add("X-Multi", "a")
		w.Header().Add("X-Multi", "b")
		w.WriteHeader(status)
		if status != 204 && status != 304 {
			_, _ = w.Write([]byte{0, 1, 255})
		}
	}))
	defer upstream.Close()
	engine := gin.New()
	engine.Any("/api/network/proxy", httpProxy)
	engine.GET("/es/network/proxy", esProxy)
	server := httptest.NewServer(engine)
	defer server.Close()
	for _, method := range []string{"GET", "HEAD"} {
		for _, status := range []int{200, 204, 304, 404, 502} {
			path := "/api/network/proxy"
			target := upstream.URL + "?status=" + strconv.Itoa(status)
			request, _ := http.NewRequest(method, server.URL+path+"?u="+base64.RawURLEncoding.EncodeToString([]byte(target)), nil)
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != status {
				t.Fatalf("status changed: %d", response.StatusCode)
			}
			if err = bundle.ValidateHTTPResponse(method, path, status, response.Header.Get("Content-Type"), body); err != nil {
				t.Fatal(err)
			}
			if method == "HEAD" || status == 204 || status == 304 {
				if len(body) != 0 {
					t.Fatal("bodyless response has body")
				}
			} else if !bytes.Equal(body, []byte{0, 1, 255}) {
				t.Fatal("proxy bytes changed")
			}
			if response.Header.Get("X-Content-Type-Options") != "nosniff" || len(response.Header.Values("Siyuan-Proxy-X-Multi")) != 2 {
				t.Fatal("security or duplicate headers changed")
			}
		}
	}
	for _, path := range []string{"/api/network/proxy", "/es/network/proxy"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if err = bundle.ValidateHTTPResponse("GET", path, response.StatusCode, response.Header.Get("Content-Type"), body); err != nil {
			t.Fatal(err)
		}
		if string(body) != `{"code":-1,"msg":"missing query param [u]"}` {
			t.Fatalf("rejection changed: %s", body)
		}
	}
}

func TestAPIContractNetworkWebSocketProxy(t *testing.T) {
	bundle := networkTestBundle(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, http.Header{"X-Upstream": []string{"yes"}})
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err = conn.WriteMessage(kind, data); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	engine := gin.New()
	engine.GET("/ws/network/proxy", wsProxy)
	server := httptest.NewServer(engine)
	defer server.Close()
	target := "ws" + strings.TrimPrefix(upstream.URL, "http")
	proxyURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/network/proxy?u=" + base64.RawURLEncoding.EncodeToString([]byte(target))
	conn, response, err := websocket.DefaultDialer.Dial(proxyURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if response.Header.Get("Siyuan-Proxy-X-Upstream") != "yes" {
		t.Fatal("upgrade headers changed")
	}
	if err = bundle.ValidateHTTPResponse("GET", "/ws/network/proxy", response.StatusCode, response.Header.Get("Content-Type"), nil); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []int{websocket.TextMessage, websocket.BinaryMessage} {
		data := []byte("text")
		if kind == websocket.BinaryMessage {
			data = []byte{0, 255}
		}
		if err = conn.WriteMessage(kind, data); err != nil {
			t.Fatal(err)
		}
		actualKind, actual, err := conn.ReadMessage()
		if err != nil || actualKind != kind || !bytes.Equal(actual, data) {
			t.Fatalf("frame changed: %d %x %v", actualKind, actual, err)
		}
	}
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1000, "done"))
	_, _, err = conn.ReadMessage()
	if !websocket.IsCloseError(err, 1000) {
		t.Fatalf("close changed: %v", err)
	}
	_, response, err = websocket.DefaultDialer.Dial(proxyURL, http.Header{"Origin": []string{"https://foreign.example"}})
	if err == nil {
		t.Fatal("cross-origin upgrade accepted")
	}
	if response == nil {
		t.Fatal("missing upgrade error")
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatalf("origin status changed: %d", response.StatusCode)
	}
	if err = bundle.ValidateHTTPResponse("GET", "/ws/network/proxy", response.StatusCode, response.Header.Get("Content-Type"), body); err != nil {
		t.Fatal(err)
	}
}
