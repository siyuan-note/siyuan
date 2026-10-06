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
	"github.com/siyuan-note/siyuan/kernel/plugin/formdata"
	"github.com/siyuan-note/siyuan/kernel/plugin/streams"
	"github.com/siyuan-note/siyuan/kernel/util"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func serviceTestWrite(c *gin.Context, response apicontract.Response[apicontract.PluginServiceContent]) {
	_ = apicontract.PluginPrivateService.Status(response)
	response.Stream()(c.Writer, c.Request)
}
func serviceTestHandler(c *gin.Context) {
	serviceTestWrite(c, PreparePrivateService(c, apicontract.EmptyRequest{}))
}

// newPluginServiceWorkspace 把工作空间指向临时目录，插件私有服务的文件响应以此为边界。
func newPluginServiceWorkspace(t *testing.T) (ret string) {
	t.Helper()
	oldWorkspaceDir := util.WorkspaceDir
	ret = t.TempDir()
	util.WorkspaceDir = ret
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspaceDir })
	return
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
		p.formDataHost = formdata.Enable(rt)
		p.streamsHost = streams.Enable(rt)
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
	file := filepath.Join(newPluginServiceWorkspace(t), "content.txt")
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
				serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{StatusCode: 200, Headers: map[string][]string{"X-Value": {"first", "last"}}, Cookies: []*http.Cookie{{Name: "a", Value: "1"}, {Name: "b", Value: "2"}}, Body: tt.body}))
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
		serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{StatusCode: 202, Body: &ResponseBody{Proxy: &ResponseProxy{URL: upstream.URL}}}))
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
	file := filepath.Join(newPluginServiceWorkspace(t), "range.txt")
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
		serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{StatusCode: status, Body: body}))
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

// TestPluginServiceStreamResponse 验证 response.body.stream：第一块数据到达时响应已经在传输（没有等整个流
// 读完才一次性写出），第二块要等插件自己（通过一个暴露给脚本的 Promise）决定产出才会出现。
func TestPluginServiceStreamResponse(t *testing.T) {
	p, cancel := newServiceTestPlugin(t, `globalThis.siyuan={server:{private:{http:{handler:(r)=>{
		let pulled = false;
		const stream = new ReadableStream({
			start(controller) { controller.enqueue(new Uint8Array([102,105,114,115,116,45])); },
			pull(controller) {
				if (!pulled) { pulled = true; return; }
				return __secondChunkReady().then(() => {
					controller.enqueue(new Uint8Array([115,101,99,111,110,100]));
					controller.close();
				});
			},
		});
		return {statusCode: 200, headers: {"X-Stream": ["yes"]}, body: {stream: {contentType: "text/plain", stream}}};
	}}}}};`)
	defer cancel()

	var resolveSecondChunk func(any) error
	if _, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		return nil, rt.Set("__secondChunkReady", func(goja.FunctionCall) goja.Value {
			promise, resolve, _ := rt.NewPromise()
			resolveSecondChunk = resolve
			return rt.ToValue(promise)
		})
	}); err != nil {
		t.Fatalf("expose __secondChunkReady: %v", err)
	}

	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	server := httptest.NewServer(engine)
	defer server.Close()

	response, err := http.Get(server.URL + "/plugin/private/" + p.Name + "/chunks")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("X-Stream") != "yes" || response.Header.Get("Content-Type") != "text/plain" {
		t.Fatalf("stream response headers changed: %d %v", response.StatusCode, response.Header)
	}

	first := make([]byte, 6)
	if _, err = io.ReadFull(response.Body, first); err != nil || string(first) != "first-" {
		t.Fatalf("first chunk changed: %q %v", first, err)
	}

	// 这时候第二块还没有被放行；用一个短超时确认连接仍然卡在第一块之后，证明不是整体缓冲后一次性写出的。
	readSecond := make(chan []byte, 1)
	go func() {
		buf := make([]byte, 6)
		if _, readErr := io.ReadFull(response.Body, buf); readErr == nil {
			readSecond <- buf
		}
	}()
	select {
	case <-readSecond:
		t.Fatal("second chunk arrived before the plugin produced it")
	case <-time.After(100 * time.Millisecond):
	}

	if _, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		return nil, resolveSecondChunk(goja.Undefined())
	}); err != nil {
		t.Fatalf("resolve __secondChunkReady: %v", err)
	}

	select {
	case second := <-readSecond:
		if string(second) != "second" {
			t.Fatalf("second chunk changed: %q", second)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for the second chunk after it was produced")
	}

	rest, err := io.ReadAll(response.Body)
	if err != nil || len(rest) != 0 {
		t.Fatalf("stream response did not end after close(): %q %v", rest, err)
	}
}

// serviceTestEval 在插件的事件循环上求值 script 并导出结果；3 秒内没有完成说明事件循环被阻塞。
func serviceTestEval(t *testing.T, p *KernelPlugin, script string) any {
	t.Helper()
	result := make(chan any, 1)
	go func() {
		value, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
			value, err := rt.RunString(script)
			if err != nil {
				return nil, err
			}
			return value.Export(), nil
		})
		if err != nil {
			value = err
		}
		result <- value
	}()
	select {
	case value := <-result:
		if err, ok := value.(error); ok {
			t.Fatalf("evaluate %q: %v", script, err)
		}
		return value
	case <-time.After(3 * time.Second):
		t.Fatalf("plugin event loop did not respond while evaluating %q", script)
	}
	return nil
}

// TestPluginServiceStreamResponseQueuedChunksAndStatus 验证插件在 start() 中一次性入队多块数据时，响应既不会卡住
// 请求，也不会卡住插件的事件循环，并且使用插件指定的状态码，没有任何数据块的空流也不例外。
func TestPluginServiceStreamResponseQueuedChunksAndStatus(t *testing.T) {
	p, cancel := newServiceTestPlugin(t, `globalThis.siyuan={server:{private:{http:{handler:(r)=>{
		const count = Number(r.context.path.slice(1));
		const stream = new ReadableStream({
			start(controller) {
				for (let i = 0; i < count; i++) controller.enqueue(new Uint8Array([48 + i]));
				controller.close();
			},
		});
		return {statusCode: 201, body: {stream: {contentType: "text/plain", stream}}};
	}}}}};`)
	defer cancel()

	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	server := httptest.NewServer(engine)
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}

	for _, tt := range []struct{ path, want string }{{"/8", "01234567"}, {"/0", ""}} {
		response, err := client.Get(server.URL + "/plugin/private/" + p.Name + tt.path)
		if err != nil {
			t.Fatalf("GET %s: %v", tt.path, err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusCreated || string(data) != tt.want {
			t.Fatalf("GET %s = %d %q %v, want %d %q", tt.path, response.StatusCode, data, err, http.StatusCreated, tt.want)
		}
		serviceTestEval(t, p, "0")
	}
}

// TestPluginServiceStreamResponseBackpressure 验证客户端不读取响应体时，内核只按写出进度向流拉取数据，插件的
// 事件循环保持可用；客户端断开连接后流被取消。每块 1 MiB，写满连接缓冲区后写出被阻塞，拉取次数随之停止增长。
func TestPluginServiceStreamResponseBackpressure(t *testing.T) {
	p, cancel := newServiceTestPlugin(t, `globalThis.__pulls = 0; globalThis.__cancelled = false;
	globalThis.siyuan={server:{private:{http:{handler:()=>({statusCode: 200, body: {stream: {stream: new ReadableStream({
		pull(controller) { globalThis.__pulls++; controller.enqueue(new Uint8Array(1 << 20)); },
		cancel() { globalThis.__cancelled = true; },
	})}}})}}}};`)
	defer cancel()

	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", serviceTestHandler)
	server := httptest.NewServer(engine)
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}

	response, err := client.Get(server.URL + "/plugin/private/" + p.Name + "/endless")
	if err != nil {
		t.Fatal(err)
	}

	pulls := func() int64 { return serviceTestEval(t, p, "globalThis.__pulls").(int64) }
	deadline := time.Now().Add(3 * time.Second)
	previous := pulls()
	for {
		time.Sleep(200 * time.Millisecond)
		current := pulls()
		if current == previous {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("stream kept being pulled while the client was not reading: %d pulls", current)
		}
		previous = current
	}
	if previous > 64 {
		t.Fatalf("stream was pulled far ahead of the client: %d pulls", previous)
	}

	response.Body.Close()
	for !serviceTestEval(t, p, "globalThis.__cancelled").(bool) {
		if time.Now().After(deadline.Add(3 * time.Second)) {
			t.Fatal("stream was not cancelled after the client disconnected")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestPluginServiceFileConfinedToWorkspace 校验插件私有服务只能服务工作空间内的文件。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-phmw-4rgv-r4xv
func TestPluginServiceFileConfinedToWorkspace(t *testing.T) {
	root := newPluginServiceWorkspace(t)
	const secret = "PLUGIN-FILE-DISCLOSURE-SECRET"

	outsideDir := t.TempDir()
	outside := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(outside, []byte(secret), 0600); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "inside.txt")
	if err := os.WriteFile(inside, []byte("inside content"), 0600); err != nil {
		t.Fatal(err)
	}

	request := func(path string) *httptest.ResponseRecorder {
		engine := gin.New()
		engine.Any("/plugin/private/:name/*path", func(c *gin.Context) {
			serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
				StatusCode: 200,
				Body:       &ResponseBody{File: &ResponseFile{Path: path}},
			}))
		})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugin/private/test/file", nil))
		return recorder
	}

	// 控制组：工作空间内的文件照常服务
	recorder := request(inside)
	if "inside content" != recorder.Body.String() || http.StatusOK != recorder.Code {
		t.Fatalf("in-workspace file was not served: %d %q", recorder.Code, recorder.Body.String())
	}

	// 控制组：ResponseFile.Path 的文档示例形式（以工作空间根为基准、带前导斜杠）照常服务
	example := filepath.Join(root, "data", "plugins", "sample", "app", "index.html")
	if err := os.MkdirAll(filepath.Dir(example), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(example, []byte("plugin page"), 0600); err != nil {
		t.Fatal(err)
	}
	recorder = request("/data/plugins/sample/app/index.html")
	if "plugin page" != recorder.Body.String() || http.StatusOK != recorder.Code {
		t.Fatalf("documented leading-slash path was not served: %d %q", recorder.Code, recorder.Body.String())
	}

	for _, tt := range []struct {
		name string
		path string
	}{
		{"absolute path outside the workspace", outside},
		{"relative traversal outside the workspace", strings.Repeat("../", 16) + "etc/hosts"},
		{"workspace escaped by ..", filepath.Join(root, "..", "..", filepath.Base(outsideDir), "secret.txt")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			recorder := request(tt.path)
			if strings.Contains(recorder.Body.String(), secret) {
				t.Fatalf("plugin service served a file outside the workspace: %q", recorder.Body.String())
			}
			if http.StatusNotFound != recorder.Code {
				t.Fatalf("unexpected status %d: %q", recorder.Code, recorder.Body.String())
			}
		})
	}

	// 工作空间内的符号链接指向工作空间外时同样拒绝
	t.Run("symlink pointing outside the workspace", func(t *testing.T) {
		link := filepath.Join(root, "link.txt")
		if err := os.Symlink(outside, link); err != nil {
			// Windows 未开启开发者模式时创建符号链接需要特权，链接解析本身由 model 的用例覆盖
			t.Skipf("symlink is unavailable: %s", err)
		}
		recorder := request(link)
		if strings.Contains(recorder.Body.String(), secret) {
			t.Fatalf("plugin service followed a symlink outside the workspace: %q", recorder.Body.String())
		}
		if http.StatusNotFound != recorder.Code {
			t.Fatalf("unexpected status %d: %q", recorder.Code, recorder.Body.String())
		}
	})
}
