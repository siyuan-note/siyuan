// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/plugin/streams"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// startClientFetchTest 启动由 handler 处理请求的内核替身，并返回事件循环已启动的测试插件。
func startClientFetchTest(t *testing.T, handler http.HandlerFunc) *KernelPlugin {
	t.Helper()

	server := httptest.NewServer(handler)
	// 先断开连接，使仍在等待请求上下文的处理函数返回；否则请求未被取消时 Close 会一直等待。
	t.Cleanup(func() {
		server.CloseClientConnections()
		server.Close()
	})

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	originalPort := util.ServerPort
	util.ServerPort = serverURL.Port()
	t.Cleanup(func() { util.ServerPort = originalPort })

	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-client-fetch"}, context: ctx, cancel: cancel}
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	loop.Start()
	t.Cleanup(func() {
		cancel()
		loop.Stop()
	})
	return p
}

// runClientFetchScript 在插件运行时中执行脚本；脚本调用 settle(reason) 报告结果，空字符串表示成功。
func runClientFetchScript(t *testing.T, p *KernelPlugin, script string) <-chan string {
	t.Helper()

	settled := make(chan string, 1)
	_, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		// 与生产环境一致先启用 AbortController、FormData、Streams 等全局，供脚本中的 init.signal、init.body、
		// response.body 使用。
		EnableAbortAPI(rt)
		p.formDataHost = EnableFormDataAPI(rt)
		p.streamsHost = streams.Enable(rt)

		siyuan := rt.NewObject()
		if injectErr := injectClient(p, rt, siyuan); injectErr != nil {
			return nil, injectErr
		}
		if setErr := rt.Set("siyuan", siyuan); setErr != nil {
			return nil, setErr
		}
		if setErr := rt.Set("settle", func(call goja.FunctionCall) goja.Value {
			settled <- call.Argument(0).String()
			return goja.Undefined()
		}); setErr != nil {
			return nil, setErr
		}
		_, runErr := rt.RunString(script)
		return nil, runErr
	})
	if err != nil {
		t.Fatalf("run fetch script failed: %v", err)
	}
	return settled
}

// waitClientFetchSettled 等待脚本报告结果。
func waitClientFetchSettled(t *testing.T, settled <-chan string) string {
	t.Helper()

	select {
	case reason := <-settled:
		return reason
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch promise")
		return ""
	}
}

// fetchAndSettle 返回以 init 请求 path 并报告结果的脚本。
func fetchAndSettle(path, init string) string {
	return fmt.Sprintf(`siyuan.client.fetch(%q, %s).then(() => settle(""), (e) => settle(String(e)));`, path, init)
}

// setClientFetchDefaultTimeout 在测试期间替换 siyuan.client.fetch 的默认时限。
func setClientFetchDefaultTimeout(t *testing.T, timeout time.Duration) {
	t.Helper()

	original := fetchDefaultTimeout
	fetchDefaultTimeout = timeout
	t.Cleanup(func() { fetchDefaultTimeout = original })
}

// waitForClientGone 在客户端放弃请求前不返回，模拟迟迟不响应的接口。
func waitForClientGone(_ http.ResponseWriter, r *http.Request) {
	<-r.Context().Done()
}

// respondAfter 在 delay 之后才响应；客户端提前放弃时立即返回。
func respondAfter(delay time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(delay):
			io.WriteString(w, "done")
		case <-r.Context().Done():
		}
	}
}

func TestClientFetchCopiesArrayBufferBody(t *testing.T) {
	received := make(chan []byte, 1)
	p := startClientFetchTest(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- body
	})

	// 请求在脚本修改缓冲区之后才发出，使共享 ArrayBuffer 内存的实现必然发送被修改的内容。
	mutated := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(mutated) }) }
	t.Cleanup(release)
	originalClient := httpClient
	httpClient = req.C().SetTimeout(5 * time.Second).OnBeforeRequest(func(*req.Client, *req.Request) error {
		<-mutated
		return nil
	})
	t.Cleanup(func() { httpClient = originalClient })

	settled := runClientFetchScript(t, p, `
		const body = new Uint8Array([1, 2, 3, 4]);
		siyuan.client.fetch("/echo", {method: "POST", body: body.buffer})
			.then(() => settle(""), (e) => settle(String(e)));
		body.fill(0);
	`)
	release()

	select {
	case body := <-received:
		if !bytes.Equal(body, []byte{1, 2, 3, 4}) {
			t.Fatalf("request body = %v, want the ArrayBuffer content at call time [1 2 3 4]", body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}

	if reason := waitClientFetchSettled(t, settled); reason != "" {
		t.Fatalf("fetch rejected: %s", reason)
	}
}

// multipartRequest 是内核替身收到的 multipart 请求：Content-Type 头与按 Go 的 mime/multipart 解析出的表单。
type multipartRequest struct {
	contentTypes []string
	values       string              // 按字段名排序的 fmt 格式输出
	files        map[string][]string // 同名文件按请求中的顺序排列
	err          error
}

// receiveMultipart 返回解析 multipart 请求并把结果发到 requests 的处理函数；文件以 "文件名|类型|内容" 记录。
func receiveMultipart(requests chan<- multipartRequest) http.HandlerFunc {
	return func(_ http.ResponseWriter, r *http.Request) {
		received := multipartRequest{contentTypes: r.Header.Values("Content-Type")}
		if received.err = r.ParseMultipartForm(1 << 20); received.err == nil {
			received.values = fmt.Sprint(r.MultipartForm.Value)
			received.files = map[string][]string{}
			for name, headers := range r.MultipartForm.File {
				for _, header := range headers {
					file, err := header.Open()
					if err != nil {
						received.err = err
						break
					}
					content, err := io.ReadAll(file)
					file.Close()
					if err != nil {
						received.err = err
						break
					}
					received.files[name] = append(received.files[name],
						header.Filename+"|"+header.Header.Get("Content-Type")+"|"+string(content))
				}
			}
		}
		requests <- received
	}
}

// waitMultipartRequest 等待内核替身收到请求。
func waitMultipartRequest(t *testing.T, requests <-chan multipartRequest) multipartRequest {
	t.Helper()

	select {
	case received := <-requests:
		return received
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
		return multipartRequest{}
	}
}

func TestClientFetchSendsFormDataAsMultipart(t *testing.T) {
	requests := make(chan multipartRequest, 1)
	p := startClientFetchTest(t, receiveMultipart(requests))

	settled := runClientFetchScript(t, p, `
		const body = new FormData();
		body.append("assetsDirPath", "/assets/");
		body.append("file[]", new File(["hello"], "hello.txt", {type: "text/plain"}));
		body.append("file[]", new Blob([new Uint8Array([0, 255])]), "raw.bin");
		siyuan.client.fetch("/api/asset/upload", {method: "POST", body})
			.then(() => settle(""), (e) => settle(String(e)));
	`)

	received := waitMultipartRequest(t, requests)
	if received.err != nil {
		t.Fatalf("parse multipart request: %v (Content-Type %q)", received.err, received.contentTypes)
	}
	if len(received.contentTypes) != 1 || !strings.HasPrefix(received.contentTypes[0], "multipart/form-data; boundary=") {
		t.Fatalf("Content-Type = %q, want a single multipart/form-data type with the generated boundary",
			received.contentTypes)
	}
	if want := "map[assetsDirPath:[/assets/]]"; received.values != want {
		t.Fatalf("form values = %s, want %s", received.values, want)
	}
	want := []string{"hello.txt|text/plain|hello", "raw.bin|application/octet-stream|\x00\xff"}
	if got := received.files["file[]"]; !slices.Equal(got, want) {
		t.Fatalf("form files = %q, want %q", got, want)
	}
	if reason := waitClientFetchSettled(t, settled); reason != "" {
		t.Fatalf("fetch rejected: %s", reason)
	}
}

func TestClientFetchKeepsExplicitContentTypeForFormData(t *testing.T) {
	contentTypes := make(chan []string, 1)
	p := startClientFetchTest(t, func(_ http.ResponseWriter, r *http.Request) {
		contentTypes <- r.Header.Values("Content-Type")
	})

	settled := runClientFetchScript(t, p, `
		const body = new FormData();
		body.append("a", "1");
		const headers = {"content-type": "multipart/form-data; boundary=caller"};
		siyuan.client.fetch("/", {method: "POST", body, headers}).then(() => settle(""), (e) => settle(String(e)));
	`)

	select {
	case got := <-contentTypes:
		if len(got) != 1 || got[0] != "multipart/form-data; boundary=caller" {
			t.Fatalf("Content-Type = %q, want only the caller's value", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}
	if reason := waitClientFetchSettled(t, settled); reason != "" {
		t.Fatalf("fetch rejected: %s", reason)
	}
}

func TestClientFetchEncodesFormDataAtCallTime(t *testing.T) {
	requests := make(chan multipartRequest, 1)
	p := startClientFetchTest(t, receiveMultipart(requests))

	// fetch 之后的修改与 fetch 位于同一段同步脚本中，请求任务只能在脚本结束后执行，
	// 因此推迟到请求任务里才编码的实现必然发送修改后的内容。
	settled := runClientFetchScript(t, p, `
		const body = new FormData();
		body.append("a", "1");
		siyuan.client.fetch("/", {method: "POST", body}).then(() => settle(""), (e) => settle(String(e)));
		body.set("a", "changed");
		body.append("late", "x");
	`)

	received := waitMultipartRequest(t, requests)
	if received.err != nil {
		t.Fatalf("parse multipart request: %v", received.err)
	}
	if want := "map[a:[1]]"; received.values != want {
		t.Fatalf("form values = %s, want the entries at call time %s", received.values, want)
	}
	if reason := waitClientFetchSettled(t, settled); reason != "" {
		t.Fatalf("fetch rejected: %s", reason)
	}
}

func TestClientFetchResponseBytesAndBlob(t *testing.T) {
	p := startClientFetchTest(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "Image/PNG")
		w.Write([]byte{0x89, 'P', 'N', 'G'})
	})

	// response.blob() 整体读完响应体并认领它；blob 本身不是一次性的，可以反复调用其方法；
	// 响应体被认领后，response 上的另一个数据方法（这里用 bytes()）必须按 bodyUsed 语义拒绝。
	got := waitClientFetchSettled(t, runClientFetchScript(t, p, `
		siyuan.client.fetch("/image").then(async (response) => {
			const blob = await response.blob();
			const bytesFromBlob = Array.from(await blob.bytes());
			const bytesFromBlobAgain = Array.from(new Uint8Array(await blob.arrayBuffer()));
			let secondCallRejected = false;
			try { await response.bytes(); } catch (e) { secondCallRejected = e instanceof TypeError; }
			settle(JSON.stringify([blob.type, bytesFromBlob, bytesFromBlobAgain, secondCallRejected]));
		}).catch((e) => settle(String(e)));
	`))
	if want := `["image/png",[137,80,78,71],[137,80,78,71],true]`; got != want {
		t.Fatalf("response bytes() and blob() = %s, want %s", got, want)
	}
}

// TestClientFetchResponseBodyStreamsChunks 验证 response.body 是真正边到边读的流：第一块数据到达时
// fetch() 已经 resolve，第二块数据要等服务端继续写入才会出现，不是构造响应对象时就已经整体读完。
func TestClientFetchResponseBodyStreamsChunks(t *testing.T) {
	secondChunk := make(chan struct{})
	p := startClientFetchTest(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "first-")
		w.(http.Flusher).Flush()
		select {
		case <-secondChunk:
		case <-r.Context().Done():
			return
		}
		io.WriteString(w, "second")
	})

	// 必须在运行主脚本之前就把这个 Go 回调挂到 globalThis 上：主脚本是异步的（先等 fetch 的 Promise resolve
	// 再读 body），调用它时才去设置回调会有时间窗口竞争，脚本可能在回调还没挂上去之前就先调用到它。
	// p.worker 的事件循环只有一个 goja.Runtime，这里设置的全局在后续 runClientFetchScript 里仍然可见。
	if _, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		return nil, rt.Set("__unblockSecondChunk", func(goja.FunctionCall) goja.Value {
			close(secondChunk)
			return goja.Undefined()
		})
	}); err != nil {
		t.Fatalf("expose __unblockSecondChunk: %v", err)
	}

	settled := runClientFetchScript(t, p, `
		siyuan.client.fetch("/chunks").then(async (response) => {
			const reader = response.body.getReader();
			const first = await reader.read();
			const firstBytes = Array.from(first.value);
			__unblockSecondChunk();
			const second = await reader.read();
			const third = await reader.read();
			settle(JSON.stringify([firstBytes, Array.from(second.value), third.done]));
		}, (e) => settle("fetch-rejected:" + String(e))).catch((e) => settle("script-threw:" + String(e)));
	`)

	reason := waitClientFetchSettled(t, settled)
	if want := `[[102,105,114,115,116,45],[115,101,99,111,110,100],true]`; reason != want {
		t.Fatalf("response.body chunks = %s, want %s", reason, want)
	}
}

// TestClientFetchResponseBodyCancelReleasesConnection 验证取消 response.body 的 reader 会关闭底层连接，
// 不需要把响应体读完。
func TestClientFetchResponseBodyCancelReleasesConnection(t *testing.T) {
	serverSawCancellation := make(chan struct{})
	p := startClientFetchTest(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "first-")
		w.(http.Flusher).Flush()
		<-r.Context().Done() // reader.cancel() 关闭连接后，服务端的请求 context 会被取消
		close(serverSawCancellation)
	})

	settled := runClientFetchScript(t, p, `
		siyuan.client.fetch("/cancel-me").then(async (response) => {
			const reader = response.body.getReader();
			await reader.read();
			await reader.cancel("not interested");
			settle("cancelled");
		}, (e) => settle("fetch-rejected:" + String(e)));
	`)
	if reason := waitClientFetchSettled(t, settled); reason != "cancelled" {
		t.Fatalf("fetch settled with %q, want \"cancelled\"", reason)
	}
	select {
	case <-serverSawCancellation:
	case <-time.After(5 * time.Second):
		t.Fatal("server did not observe the connection closing after reader.cancel()")
	}
}

func TestClientFetchAppliesDefaultTimeout(t *testing.T) {
	setClientFetchDefaultTimeout(t, 50*time.Millisecond)

	for _, init := range []string{"undefined", "{}", "{timeout: undefined}", "{timeout: null}"} {
		t.Run(init, func(t *testing.T) {
			p := startClientFetchTest(t, waitForClientGone)
			reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/pending", init)))
			if !strings.Contains(reason, "timed out after 50ms") {
				t.Fatalf("fetch settled with %q, want the default timeout", reason)
			}
		})
	}
}

func TestClientFetchTimeoutOverridesDefault(t *testing.T) {
	t.Run("shorter", func(t *testing.T) {
		p := startClientFetchTest(t, waitForClientGone)
		reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/pending", "{timeout: 50}")))
		if !strings.Contains(reason, "timed out after 50ms") {
			t.Fatalf("fetch settled with %q, want the request timeout", reason)
		}
	})

	for _, test := range []struct{ name, init string }{
		{"longer", "{timeout: 5000}"},
		{"disabled", "{timeout: 0}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			setClientFetchDefaultTimeout(t, 50*time.Millisecond)
			p := startClientFetchTest(t, respondAfter(200*time.Millisecond))
			if reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/delayed", test.init))); reason != "" {
				t.Fatalf("fetch rejected: %s", reason)
			}
		})
	}
}

// timeout 现在只约束到收到响应头为止：响应头已经到达后，即便响应体一直不来，fetch() 本身也必须 resolve，
// 之后读取响应体不再受这个已经停掉的计时器约束，与浏览器 fetch 的 timeout/AbortSignal 分离语义一致。
func TestClientFetchTimeoutCoversOnlyHeadersNotResponseBody(t *testing.T) {
	p := startClientFetchTest(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "partial")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})

	settled := runClientFetchScript(t, p, `
		siyuan.client.fetch("/stalled", {timeout: 50}).then((response) => {
			const textPromise = response.text();
			const stillPending = new Promise((resolve) => setTimeout(() => resolve("still-pending"), 150));
			Promise.race([textPromise, stillPending]).then(
				(result) => settle("resolved:" + response.status + ":" + result),
				(e) => settle("text-rejected:" + String(e)),
			);
		}, (e) => settle("fetch-rejected:" + String(e)));
	`)
	reason := waitClientFetchSettled(t, settled)
	if want := "resolved:200:still-pending"; reason != want {
		t.Fatalf("fetch settled with %q, want %q (fetch() resolves at headers, and reading the body is not bounded "+
			"by the already-expired timeout)", reason, want)
	}
}

func TestClientFetchRejectsImmediatelyWhenSignalAlreadyAborted(t *testing.T) {
	p := startClientFetchTest(t, func(http.ResponseWriter, *http.Request) {
		t.Error("fetch sent a request although its signal was already aborted")
	})

	reason := waitClientFetchSettled(t, runClientFetchScript(t, p, `
		const controller = new AbortController();
		controller.abort("already gone");
		siyuan.client.fetch("/", {signal: controller.signal}).then(() => settle(""), (e) => settle(String(e)));
	`))
	if reason != "already gone" {
		t.Fatalf("fetch settled with %q, want the signal's reason", reason)
	}
}

func TestClientFetchRejectsWithSignalReasonWhenAbortedMidFlight(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	p := startClientFetchTest(t, func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})

	settled := runClientFetchScript(t, p, `
		const controller = new AbortController();
		siyuan.client.fetch("/pending", {signal: controller.signal, timeout: 0})
			.then(() => settle(""), (e) => settle(String(e)));
		globalThis.__controller = controller;
	`)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}

	if _, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		controller := rt.GlobalObject().Get("__controller")
		fn, _ := goja.AssertFunction(controller.ToObject(rt).Get("abort"))
		_, callErr := fn(controller, rt.ToValue("mid-flight abort"))
		return nil, callErr
	}); err != nil {
		t.Fatalf("controller.abort(): %v", err)
	}

	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("pending request was not cancelled by the signal")
	}
	if reason := waitClientFetchSettled(t, settled); reason != "mid-flight abort" {
		t.Fatalf("fetch settled with %q, want the signal's reason", reason)
	}
}

func TestClientFetchSignalAbortDoesNotMaskUnrelatedCancellation(t *testing.T) {
	// 插件停止（父上下文取消）与 signal 中止是不同的取消来源，前者仍应保留原有的 "context canceled" 行为。
	started := make(chan struct{})
	cancelled := make(chan struct{})
	p := startClientFetchTest(t, func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})

	settled := runClientFetchScript(t, p, `
		const controller = new AbortController();
		siyuan.client.fetch("/pending", {signal: controller.signal, timeout: 0})
			.then(() => settle(""), (e) => settle(String(e)));
	`)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}

	p.cancel()
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("pending request was not cancelled with the plugin context")
	}
	if reason := waitClientFetchSettled(t, settled); !strings.Contains(reason, "context canceled") {
		t.Fatalf("fetch settled with %q, want cancellation unrelated to the signal", reason)
	}
}

func TestClientFetchRejectsNonAbortSignalInit(t *testing.T) {
	p := startClientFetchTest(t, func(http.ResponseWriter, *http.Request) {
		t.Error("fetch sent a request with an invalid signal")
	})

	for _, signal := range []string{"{}", `"not a signal"`, "123"} {
		reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/", "{signal: "+signal+"}")))
		if !strings.Contains(reason, "signal must be an AbortSignal") {
			t.Errorf("signal %s: fetch settled with %q", signal, reason)
		}
	}
}

func TestClientFetchRejectsInvalidTimeout(t *testing.T) {
	p := startClientFetchTest(t, func(http.ResponseWriter, *http.Request) {
		t.Error("fetch sent a request with an invalid timeout")
	})

	for _, timeout := range []string{"-1", "NaN", "Infinity", "-Infinity", `"1000"`, "true", "{valueOf: () => 1000}", "1000n"} {
		reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/", "{timeout: "+timeout+"}")))
		if !strings.Contains(reason, "timeout must be a non-negative finite number") {
			t.Errorf("timeout %s: fetch settled with %q", timeout, reason)
		}
	}
}

func TestFetchTimeoutOf(t *testing.T) {
	rt := goja.New()
	for _, test := range []struct {
		expression string
		want       time.Duration
	}{
		{"0", 0},
		{"-0", 0},
		{"1500", 1500 * time.Millisecond},
		{"1.5", 1500 * time.Microsecond},
		// 不足 1 纳秒的正数不能变成表示不限时的 0。
		{"1e-9", time.Nanosecond},
		{"1e300", math.MaxInt64},
	} {
		value, err := rt.RunString(test.expression)
		if err != nil {
			t.Fatal(err)
		}
		if got, err := fetchTimeoutOf(value); err != nil || got != test.want {
			t.Errorf("fetchTimeoutOf(%s) = %v, %v; want %v", test.expression, got, err, test.want)
		}
	}
}

func TestClientFetchCancelsPendingRequestWithPluginContext(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	p := startClientFetchTest(t, func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})

	settled := runClientFetchScript(t, p, fetchAndSettle("/pending", "{timeout: 0}"))
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for fetch request")
	}

	p.cancel()
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("pending request was not cancelled with the plugin context")
	}
	if reason := waitClientFetchSettled(t, settled); !strings.Contains(reason, "context canceled") {
		t.Fatalf("fetch settled with %q, want cancellation", reason)
	}
}

func TestClientFetchSharedClientHasNoTimeout(t *testing.T) {
	// 共享客户端的整体超时会截断比它更长的请求时限。
	if timeout := httpClient.GetClient().Timeout; timeout != 0 {
		t.Fatalf("shared client timeout = %v, want 0", timeout)
	}
}
