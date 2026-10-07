package plugin

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func newSSETestPlugin(t *testing.T) (*KernelPlugin, <-chan struct{}, <-chan struct{}) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	loop := eventloop.NewEventLoop()
	p := &KernelPlugin{Petal: &model.Petal{Name: "sse-test"}, context: ctx, cancel: cancel, runtime: loop}
	p.worker.Start(loop)
	opened, closed := make(chan struct{}), make(chan struct{})
	loop.Run(func(rt *goja.Runtime) {
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		if err := rt.Set("notifyOpen", func() { close(opened) }); err != nil {
			t.Fatal(err)
		}
		if err := rt.Set("notifyClose", func() { close(closed) }); err != nil {
			t.Fatal(err)
		}
		if _, err := rt.RunString(`globalThis.siyuan = {server: {private: {es: {handler(request) {
			globalThis.port = request.port;
			port.onopen = notifyOpen;
			port.onclose = notifyClose;
		}}}}};`); err != nil {
			t.Fatal(err)
		}
	})
	loop.Start()
	t.Cleanup(func() {
		cancel()
		stopped := make(chan struct{})
		go func() {
			loop.Terminate()
			close(stopped)
		}()
		sseTestWait(t, stopped, "event loop termination")
	})
	return p, opened, closed
}

func sseTestWait(t *testing.T, done <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

func sseTestRun(t *testing.T, p *KernelPlugin, script string) {
	t.Helper()
	done := make(chan struct{})
	var runErr error
	if err := p.worker.Run(func(rt *goja.Runtime) (any, error) {
		return rt.RunString(script)
	}, func(_ *goja.Runtime, _ any, err error) {
		runErr = err
		close(done)
	}); err != nil {
		t.Fatal(err)
	}
	sseTestWait(t, done, "script completion")
	if runErr != nil {
		t.Fatal(runErr)
	}
}

func startSSETestRequest(t *testing.T, p *KernelPlugin, ctx context.Context, recorder http.ResponseWriter) <-chan struct{} {
	t.Helper()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/events", nil).WithContext(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := p.handleServerSentEventRequest(c, &Request{}, AccessScopePrivate); err != nil {
			t.Errorf("SSE request failed: %v", err)
		}
	}()
	return done
}

func TestSSESendAfterStreamClosed(t *testing.T) {
	for _, reason := range []string{"port_close", "client_disconnect", "plugin_stop"} {
		t.Run(reason, func(t *testing.T) {
			p, opened, closed := newSSETestPlugin(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := startSSETestRequest(t, p, ctx, httptest.NewRecorder())
			sseTestWait(t, opened, "onopen")
			switch reason {
			case "port_close":
				sseTestRun(t, p, "port.close();")
			case "client_disconnect":
				cancel()
			case "plugin_stop":
				p.cancel()
			}
			sseTestWait(t, done, "SSE request completion")
			sseTestWait(t, closed, "onclose")
			// 连续发送超过通道容量的事件，随后仍应能执行其他脚本。
			sseTestRun(t, p, `for (let i = 0; i < 1024; i++) { port.send({data: "late"}); }`)
			sseTestRun(t, p, "1 + 1;")
		})
	}
}

func TestSSESendBurstPreservesEvents(t *testing.T) {
	p, opened, closed := newSSETestPlugin(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const count = 64
	recorder := &sseTestRecorder{ResponseRecorder: httptest.NewRecorder(), remaining: count, flushed: make(chan struct{})}
	done := startSSETestRequest(t, p, ctx, recorder)
	sseTestWait(t, opened, "onopen")
	sseTestRun(t, p, `for (let i = 0; i < 64; i++) {
		port.send({event: "item", id: String(i), retry: 1000, data: "value-" + i});
	}`)

	sseTestWait(t, recorder.flushed, "all events flushed")
	cancel()
	sseTestWait(t, done, "SSE request completion")
	sseTestWait(t, closed, "onclose")
	var expected strings.Builder
	for i := 0; i < count; i++ {
		fmt.Fprintf(&expected, "id:%d\nevent:item\nretry:1000\ndata:value-%d\n\n", i, i)
	}
	if got := recorder.Body.String(); got != expected.String() {
		t.Fatalf("SSE burst changed: %q, want %q", got, expected.String())
	}
}

type sseTestRecorder struct {
	*httptest.ResponseRecorder
	remaining int
	flushed   chan struct{}
}

func (r *sseTestRecorder) Flush() {
	r.ResponseRecorder.Flush()
	r.remaining--
	if r.remaining == 0 {
		close(r.flushed)
	}
}
