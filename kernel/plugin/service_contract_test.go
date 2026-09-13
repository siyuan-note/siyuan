package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func serviceTestWrite(c *gin.Context, response apicontract.Response[apicontract.PluginServiceContent]) {
	_ = apicontract.PluginPrivateService.Status(response)
	response.Stream()(c.Writer, c.Request)
}
func serviceTestHandler(c *gin.Context) {
	serviceTestWrite(c, PreparePrivateService(c, apicontract.EmptyRequest{}))
}

func newServiceTestPlugin(t *testing.T, script string) (*KernelPlugin, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "contract-service"}, context: ctx}
	p.state.Store(int64(PluginStateRunning))
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	var runErr error
	loop.Run(func(rt *goja.Runtime) {
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		_, runErr = rt.RunString(script)
	})
	if runErr != nil {
		cancel()
		t.Fatal(runErr)
	}
	loop.Start()
	GetManager().plugins.Store(p.Name, p)
	t.Cleanup(func() { cancel(); loop.Stop(); GetManager().plugins.Delete(p.Name) })
	return p, cancel
}

func TestPluginServiceHTTPBranches(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "content.txt")
	if err = os.WriteFile(file, []byte("file content"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name string
		mode apicontract.PluginServiceMode
		body *ResponseBody
		want string
	}{
		{"JSON", apicontract.PluginServiceJSON, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeJSON, Data: map[string]any{"extension": []any{nil, true, 1}}}}, `{"extension":[null,true,1]}`},
		{"JSONP", apicontract.PluginServiceJSONP, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeJSONP, Data: 1}}, `callback(1);`},
		{"ASCII", apicontract.PluginServiceASCIIJSON, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeAsciiJSON, Data: "A"}}, `"A"`},
		{"Indented", apicontract.PluginServiceIndentedJSON, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeIndentedJSON, Data: []int{1}}}, "[\n    1\n]"},
		{"Pure", apicontract.PluginServicePureJSON, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypePureJSON, Data: "<tag>"}}, "\"<tag>\"\n"},
		{"Secure", apicontract.PluginServiceSecureJSON, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeSecureJSON, Data: []int{1}}}, "while(1);[1]"},
		{"XML", apicontract.PluginServiceXML, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeXML, Data: "value"}}, "<string>value</string>"},
		{"YAML", apicontract.PluginServiceYAML, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeYAML, Data: map[string]string{"key": "value"}}}, "key: value\n"},
		{"TOML", apicontract.PluginServiceTOML, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeTOML, Data: map[string]string{"key": "value"}}}, "key = 'value'\n"},
		{"ProtoBuf", apicontract.PluginServiceProtoBuf, &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeProtoBuf, Data: wrapperspb.String("x")}}, "\n\x01x"},
		{"file", apicontract.PluginServiceFile, &ResponseBody{File: &ResponseFile{Path: file, Name: "download.txt"}}, "file content"},
		{"string", apicontract.PluginServiceString, &ResponseBody{String: &ResponseString{Format: "value=%d", Values: []any{7}}}, "value=7"},
		{"raw", apicontract.PluginServiceRaw, &ResponseBody{Raw: &ResponseRawData{ContentType: "application/custom", Data: []byte{0, 255}}}, string([]byte{0, 255})},
		{"empty", apicontract.PluginServiceEmpty, nil, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			engine := gin.New()
			engine.GET("/plugin/private/:name/*path", func(c *gin.Context) {
				serviceTestWrite(c, pluginServiceHTTPResponse(c, "test", &HttpResponse{StatusCode: 200, Headers: map[string][]string{"X-Value": {"first", "last"}}, Cookies: []*http.Cookie{{Name: "a", Value: "1"}, {Name: "b", Value: "2"}}, Body: tt.body}))
			})
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugin/private/test/value?callback=callback", nil))
			if recorder.Body.String() != tt.want {
				t.Fatalf("body changed: %q want %q", recorder.Body.String(), tt.want)
			}
			if recorder.Header().Get("X-Value") != "last" || len(recorder.Header().Values("Set-Cookie")) != 2 {
				t.Fatal("plugin headers/cookies changed")
			}
			if err := bundle.ValidatePluginServiceResponse("GET", "/plugin/private/:name/*path", tt.mode, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPluginServiceAdmissionAndDispatch(t *testing.T) {
	p, _ := newServiceTestPlugin(t, `globalThis.siyuan={server:{private:{http:{handler:(r)=>({statusCode:207,headers:{"X-Path":[r.context.path]},body:{data:{type:"JSON",data:{method:r.request.method,cookie:r.request.cookies.test,authorization:r.request.headers.Authorization,path:r.context.path}}}})}}}};`)
	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	request := httptest.NewRequest("POST", "/plugin/private/"+p.Name+"/value", strings.NewReader("raw body"))
	request.Header.Set("Authorization", "secret")
	request.AddCookie(&http.Cookie{Name: "test", Value: "cookie"})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != 207 || recorder.Header().Get("X-Path") != "/value" {
		t.Fatalf("dispatch failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var data struct {
		Method        string          `json:"method"`
		Cookie        []string        `json:"cookie"`
		Authorization json.RawMessage `json:"authorization"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if data.Method != "POST" || len(data.Cookie) != 1 || len(data.Authorization) != 0 {
		t.Fatalf("request filtering changed: %s", recorder.Body.String())
	}
	for _, tt := range []struct {
		name  string
		state PluginState
		want  int
	}{{"missing", PluginStateRunning, 404}, {p.Name, PluginStateStopped, 503}} {
		p.state.Store(int64(tt.state))
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugin/private/"+tt.name+"/value", nil))
		if recorder.Code != tt.want || !strings.HasPrefix(recorder.Header().Get("Content-Type"), "text/plain") {
			t.Fatalf("admission changed: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestPluginServiceCancelledHTTPResponse(t *testing.T) {
	p, _ := newServiceTestPlugin(t, `globalThis.siyuan={server:{private:{http:{handler:()=>new Promise(()=>{})}}}};`)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest("GET", "/plugin/private/"+p.Name+"/cancelled", nil).WithContext(ctx)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != 500 || recorder.Body.Len() != 0 {
		t.Fatalf("cancelled HTTP response changed: %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestPluginServiceProxyAndFiles(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/custom")
		w.Header().Set("Set-Cookie", "upstream=secret")
		w.Header().Set("Connection", "X-Hop")
		w.Header().Set("X-Hop", "secret")
		w.WriteHeader(206)
		_, _ = w.Write([]byte{0, 255})
	}))
	defer upstream.Close()
	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", func(c *gin.Context) {
		serviceTestWrite(c, pluginServiceHTTPResponse(c, "test", &HttpResponse{StatusCode: 202, Body: &ResponseBody{Proxy: &ResponseProxy{URL: upstream.URL}}}))
	})
	for _, method := range []string{"GET", "HEAD", "POST"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(method, "/plugin/private/test/proxy", nil))
		if method == "POST" {
			if recorder.Code != 400 {
				t.Fatal("proxy method restriction changed")
			}
			continue
		}
		if recorder.Code != 206 || recorder.Header().Get("Set-Cookie") != "" || recorder.Header().Get("X-Hop") != "" {
			t.Fatal("proxy upstream status/header filtering changed")
		}
		if method == "HEAD" {
			if recorder.Body.Len() != 0 {
				t.Fatal("HEAD body changed")
			}
		} else if !bytes.Equal(recorder.Body.Bytes(), []byte{0, 255}) {
			t.Fatal("proxy bytes changed")
		}
	}
}

func TestPluginServiceFileRangesRedirectAndPriority(t *testing.T) {
	file := filepath.Join(t.TempDir(), "range.txt")
	if err := os.WriteFile(file, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", func(c *gin.Context) {
		body := &ResponseBody{File: &ResponseFile{Path: file}}
		status := 599
		switch c.Param("path") {
		case "/redirect":
			status = 302
			body = &ResponseBody{Redirect: &ResponseRedirect{Location: "/next"}}
		case "/priority":
			status = 200
			body = &ResponseBody{Data: &ResponseSerializedData{Type: SerializedTypeJSON, Data: 1}, Raw: &ResponseRawData{Data: []byte("ignored")}}
		}
		serviceTestWrite(c, pluginServiceHTTPResponse(c, "test", &HttpResponse{StatusCode: status, Body: body}))
	})
	request := httptest.NewRequest("GET", "/plugin/private/test/range", nil)
	request.Header.Set("Range", "bytes=2-4")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != 206 || recorder.Body.String() != "234" || recorder.Header().Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("file range changed: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugin/private/test/redirect", nil))
	if recorder.Code != 302 || recorder.Header().Get("Location") != "/next" {
		t.Fatal("redirect changed")
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugin/private/test/priority", nil))
	if recorder.Body.String() != "1" {
		t.Fatal("response body branch priority changed")
	}
}

func TestPluginServiceStreamingLifecycle(t *testing.T) {
	p, cancel := newServiceTestPlugin(t, `globalThis.siyuan={server:{private:{es:{handler:(r)=>{r.port.onopen=()=>{r.port.send({event:"custom",id:"7",data:{extension:[true,null,1]}});};}},ws:{handler:(r)=>{r.port.onmessage=(e)=>{r.port.send(e.data);};}}}}};`)
	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	server := httptest.NewServer(engine)
	defer server.Close()
	request, _ := http.NewRequest("GET", server.URL+"/plugin/private/"+p.Name+"/events", nil)
	request.Header.Set("Accept", "text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	expected := "id:7\nevent:custom\ndata:{\"extension\":[true,null,1]}\n\n"
	payload := make([]byte, len(expected))
	if _, err = io.ReadFull(response.Body, payload); err != nil || string(payload) != expected {
		t.Fatalf("SSE changed: %q %v", payload, err)
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/plugin/private/"+p.Name+"/socket", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err = conn.WriteMessage(websocket.TextMessage, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	kind, data, err := conn.ReadMessage()
	if err != nil || kind != websocket.TextMessage || string(data) != "hello" {
		t.Fatalf("plugin frame changed: %d %s %v", kind, data, err)
	}
	foreign, denied, denialErr := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/plugin/private/"+p.Name+"/socket", http.Header{"Origin": []string{"https://foreign.invalid"}, "Sec-Fetch-Site": []string{"cross-site"}})
	if foreign != nil {
		foreign.Close()
	}
	if denied != nil {
		denied.Body.Close()
	}
	if denialErr == nil || denied == nil || denied.StatusCode != 400 {
		t.Fatalf("service origin admission changed: %+v %v", denied, denialErr)
	}
	cancel()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err = conn.ReadMessage(); err == nil {
		t.Fatal("plugin cancellation did not close websocket")
	}
	done := make(chan error, 1)
	go func() { _, err := io.ReadAll(response.Body); done <- err }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("plugin cancellation did not close SSE")
	}
}
