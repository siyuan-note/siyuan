package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestControlConcurrencyPluginRPC(t *testing.T) {
	for _, entry := range []struct {
		name, method, url string
	}{
		{"same plugin", http.MethodPost, "/api/plugin/rpc?name=slow"},
		{"another plugin", http.MethodPost, "/api/plugin/rpc?name=other"},
		{"plugin information", http.MethodGet, "/api/plugin/rpc?name=slow"},
		{"another plugin information", http.MethodGet, "/api/plugin/rpc?name=other"},
		{"path call", http.MethodPost, "/api/plugin/rpc/slow"},
		{"path information", http.MethodGet, "/api/plugin/rpc/slow"},
	} {
		t.Run(entry.name, func(t *testing.T) {
			started := make(chan struct{})
			release := make(chan struct{})
			engine := gin.New()
			engine.Use(ControlConcurrency)
			handler := func(c *gin.Context) {
				if c.GetHeader("X-Test-Hold") == "true" {
					close(started)
					<-release
				}
				c.Status(http.StatusNoContent)
			}
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				engine.Handle(method, "/api/plugin/rpc", handler)
				engine.Handle(method, "/api/plugin/rpc/:name", handler)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := httptest.NewRequest(http.MethodPost, "/api/plugin/rpc?name=slow", nil).WithContext(ctx)
			request.Header.Set("X-Test-Hold", "true")
			held := serveConcurrencyRequest(engine, request)
			var subsequent <-chan *httptest.ResponseRecorder
			t.Cleanup(func() {
				close(release)
				awaitConcurrencyResponse(t, held)
				if subsequent != nil {
					awaitConcurrencyResponse(t, subsequent)
				}
			})
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("first RPC did not enter its handler")
			}
			// 客户端取消后，插件处理函数仍可能等待结果，其他请求应能独立完成。
			cancel()
			subsequent = serveConcurrencyRequest(engine, httptest.NewRequest(entry.method, entry.url, nil))
			awaitConcurrencyResponse(t, subsequent)
		})
	}
}

func TestControlConcurrencySerializesWrites(t *testing.T) {
	for _, path := range []string{"/api/attr/setBlockAttrs", "/api/plugin/rpcOther"} {
		t.Run(path, func(t *testing.T) {
			started := make(chan struct{})
			attempted := make(chan struct{})
			release := make(chan struct{})
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				if c.GetHeader("X-Test-Hold") != "true" {
					close(attempted)
				}
				c.Next()
			}, ControlConcurrency)
			engine.POST(path, func(c *gin.Context) {
				if c.GetHeader("X-Test-Hold") == "true" {
					close(started)
					<-release
				}
				c.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodPost, path, nil)
			request.Header.Set("X-Test-Hold", "true")
			held := serveConcurrencyRequest(engine, request)
			var subsequent <-chan *httptest.ResponseRecorder
			t.Cleanup(func() {
				close(release)
				awaitConcurrencyResponse(t, held)
				if subsequent != nil {
					awaitConcurrencyResponse(t, subsequent)
				}
			})
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("first write did not enter its handler")
			}
			subsequent = serveConcurrencyRequest(engine, httptest.NewRequest(http.MethodPost, path, nil))
			select {
			case <-attempted:
			case <-time.After(3 * time.Second):
				t.Fatal("second write did not reach the middleware")
			}
			select {
			case <-subsequent:
				t.Fatal("write completed before the first request released its lock")
			case <-time.After(100 * time.Millisecond):
			}
		})
	}
}

func serveConcurrencyRequest(engine *gin.Engine, request *http.Request) <-chan *httptest.ResponseRecorder {
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		defer close(done)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		done <- recorder
	}()
	return done
}

func awaitConcurrencyResponse(t *testing.T, done <-chan *httptest.ResponseRecorder) {
	t.Helper()
	select {
	case recorder := <-done:
		if recorder != nil && recorder.Code != http.StatusNoContent {
			t.Fatalf("unexpected status: %d", recorder.Code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("request is blocked by another handler")
	}
}
