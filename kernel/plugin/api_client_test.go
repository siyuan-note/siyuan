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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/siyuan/kernel/model"
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
		// 与生产环境一致先启用 AbortController/AbortSignal 等全局，供脚本中的 init.signal 使用。
		EnableAbortAPI(rt)

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

func TestClientFetchTimeoutCoversResponseBody(t *testing.T) {
	p := startClientFetchTest(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "partial")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})

	reason := waitClientFetchSettled(t, runClientFetchScript(t, p, fetchAndSettle("/stalled", "{timeout: 100}")))
	if !strings.Contains(reason, "timed out after 100ms") {
		t.Fatalf("fetch settled with %q, want the timeout while reading the response body", reason)
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
