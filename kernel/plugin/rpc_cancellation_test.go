package plugin

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gin-gonic/gin"
	"github.com/lxzan/gws"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func newRPCCancellationTestPlugin(t *testing.T) *KernelPlugin {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{
		Petal: &model.Petal{Name: "rpc-cancellation"}, context: ctx, cancel: cancel,
		runtime: eventloop.NewEventLoop(), sockets: map[*gws.Conn]bool{},
	}
	p.worker.Start(p.runtime)
	p.runtime.Start()
	p.state.Store(int64(PluginStateRunning))
	GetManager().plugins.Store(p.Name, p)
	t.Cleanup(func() {
		cancel()
		p.runtime.Terminate()
		GetManager().plugins.Delete(p.Name)
	})
	return p
}

func rpcCancellationTestRun(t *testing.T, p *KernelPlugin, executor TaskExecutor) {
	t.Helper()
	if _, err := p.worker.RunSync(executor); err != nil {
		t.Fatal(err)
	}
}

func rpcCancellationTestWait(t *testing.T, done <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

func rpcCancellationTestHandler(c *gin.Context) {
	endpoint := apicontract.PluginRPCHTTP
	if early := PrepareRPCContract(c); early != nil {
		c.JSON(endpoint.Status(*early), *early)
		return
	}
	request, err := endpoint.Decode(c.Request.Body)
	if err != nil {
		c.JSON(200, endpoint.DecodeFailure(err))
		return
	}
	response := DispatchRPCContract(c, request)
	if endpoint.Status(response) == 204 {
		c.Status(204)
		return
	}
	c.JSON(endpoint.Status(response), response)
}

func TestRPCHTTPWaitCancellation(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		for _, path := range []string{"/api/plugin/rpc?name=rpc-cancellation", "/api/plugin/rpc/rpc-cancellation"} {
			t.Run(path+map[bool]string{false: "/contract", true: "/legacy"}[legacy], func(t *testing.T) {
				p := newRPCCancellationTestPlugin(t)
				started := make(chan struct{})
				var resolve func(interface{}) error
				rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
					p.rpcMethods.Store("pending", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
						promise, resolvePromise, _ := rt.NewPromise()
						resolve = resolvePromise
						close(started)
						return rt.ToValue(promise), nil
					}})
					return nil, nil
				})
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				engine := gin.New()
				handler := rpcCancellationTestHandler
				if legacy {
					handler = HandleRpcHttp
				}
				engine.POST("/api/plugin/rpc", handler)
				engine.POST("/api/plugin/rpc/:name", handler)
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest("POST", path, strings.NewReader(`{"jsonrpc":"2.0","method":"pending","id":"cancelled"}`)).WithContext(ctx)
				done := make(chan struct{})
				go func() {
					engine.ServeHTTP(recorder, request)
					close(done)
				}()
				rpcCancellationTestWait(t, started, "RPC invocation")
				// 即使断言失败，也完成 Promise，避免测试自身遗留等待者。
				defer rpcCancellationTestRun(t, p, func(*goja.Runtime) (any, error) { return nil, resolve("late") })
				cancel()
				rpcCancellationTestWait(t, done, "HTTP cancellation")
				var reply JsonRpcErrorResponse
				if err := json.Unmarshal(recorder.Body.Bytes(), &reply); err != nil || reply.ID != "cancelled" || reply.Error == nil || reply.Error.Code != JsonRpcErrorCodeInternalError {
					t.Fatalf("unexpected cancellation reply: %s, %v", recorder.Body, err)
				}
			})
		}
	}
}

func TestRPCWorkerFailureReturns(t *testing.T) {
	for _, failure := range []string{"uninitialized", "terminated", "panic"} {
		t.Run(failure, func(t *testing.T) {
			p := newRPCCancellationTestPlugin(t)
			p.rpcMethods.Store("fail", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
				panic("RPC executor failure")
			}})
			switch failure {
			case "uninitialized":
				p.worker.loop = nil
			case "terminated":
				p.runtime.Terminate()
			}
			done := make(chan struct{})
			var rpcError *JsonRpcError
			go func() {
				_, rpcError = p.callRpcMethod(context.Background(), "fail", nil)
				close(done)
			}()
			rpcCancellationTestWait(t, done, "worker failure")
			if rpcError == nil || rpcError.Code != JsonRpcErrorCodeInternalError {
				t.Fatalf("unexpected worker failure: %+v", rpcError)
			}
		})
	}
}

func TestRPCPluginCancellation(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	started := make(chan struct{})
	rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
		p.rpcMethods.Store("pending", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
			promise, _, _ := rt.NewPromise()
			close(started)
			return rt.ToValue(promise), nil
		}})
		return nil, nil
	})
	done := make(chan struct{})
	var rpcError *JsonRpcError
	go func() {
		_, rpcError = p.callRpcMethod(context.Background(), "pending", nil)
		close(done)
	}()
	rpcCancellationTestWait(t, started, "RPC invocation")
	p.cancel()
	rpcCancellationTestWait(t, done, "plugin cancellation")
	if rpcError == nil || rpcError.Code != JsonRpcErrorCodeInternalError {
		t.Fatalf("unexpected plugin cancellation: %+v", rpcError)
	}
}

func TestRPCNotificationOutlivesHTTPRequest(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	called := make(chan struct{})
	rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
		p.rpcMethods.Store("notify", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
			close(called)
			return goja.Undefined(), nil
		}})
		return nil, nil
	})
	// 暂停事件循环，保证通知只能在 HTTP 返回并取消上下文后执行。
	blocked, release := make(chan struct{}), make(chan struct{})
	if err := p.worker.Run(func(*goja.Runtime) (any, error) {
		close(blocked)
		<-release
		return nil, nil
	}, nil); err != nil {
		t.Fatal(err)
	}
	defer close(release)
	rpcCancellationTestWait(t, blocked, "event loop blocker")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := gin.New()
	engine.POST("/api/plugin/rpc/:name", rpcCancellationTestHandler)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/plugin/rpc/"+p.Name, strings.NewReader(`{"jsonrpc":"2.0","method":"notify"}`)).WithContext(ctx)
	engine.ServeHTTP(recorder, request)
	cancel()
	if recorder.Code != 204 || recorder.Body.Len() != 0 {
		t.Fatalf("notification produced a reply: %d %s", recorder.Code, recorder.Body)
	}
	release <- struct{}{}
	rpcCancellationTestWait(t, called, "notification after HTTP return")
}

func TestRPCBatchWaitCancellation(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	started := make(chan struct{}, 2)
	rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
		p.rpcMethods.Store("pending", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
			promise, _, _ := rt.NewPromise()
			started <- struct{}{}
			return rt.ToValue(promise), nil
		}})
		return nil, nil
	})
	request, err := apicontract.DecodePluginRPC(strings.NewReader(`[
		{"jsonrpc":"2.0","method":"pending","id":"first"},
		{"jsonrpc":"2.0","method":"missing"},
		false,
		{"jsonrpc":"2.0","method":"pending","id":null}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	var response *apicontract.PluginRPCResponse
	go func() {
		response, err = p.dispatchRPCContract(ctx, request)
		close(done)
	}()
	rpcCancellationTestWait(t, started, "first batch call")
	rpcCancellationTestWait(t, started, "second batch call")
	cancel()
	rpcCancellationTestWait(t, done, "batch cancellation")
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var replies []JsonRpcErrorResponse
	if err := json.Unmarshal(data, &replies); err != nil || len(replies) != 3 {
		t.Fatalf("unexpected batch response: %s, %v", data, err)
	}
	for i, expected := range []JsonRpcErrorCode{JsonRpcErrorCodeInternalError, JsonRpcErrorCodeInvalidRequest, JsonRpcErrorCodeInternalError} {
		if replies[i].Error == nil || replies[i].Error.Code != expected {
			t.Fatalf("batch error order changed: %s", data)
		}
	}
	if replies[0].ID != "first" || replies[1].ID != nil || replies[2].ID != nil {
		t.Fatalf("batch IDs changed: %s", data)
	}
}

func TestRPCCancelledCallDoesNotRun(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	called := false
	p.rpcMethods.Store("write", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
		called = true
		return goja.Undefined(), nil
	}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, rpcError := p.callRpcMethod(ctx, "write", nil)
	if rpcError == nil || rpcError.Code != JsonRpcErrorCodeInternalError {
		t.Fatalf("unexpected cancellation: %+v", rpcError)
	}
	// 等待此前排队的任务处理完，检查取消的调用没有进入脚本。
	rpcCancellationTestRun(t, p, func(*goja.Runtime) (any, error) { return nil, nil })
	if called {
		t.Fatal("cancelled RPC entered the script")
	}
}

func TestRPCMethodResults(t *testing.T) {
	for _, entry := range []struct {
		name, script string
		wantError    bool
	}{
		{"synchronous", `() => 42`, false},
		{"promise", `() => Promise.resolve(42)`, false},
		{"throw", `() => { throw new Error("RPC failure"); }`, true},
		{"reject", `() => Promise.reject(new Error("RPC failure"))`, true},
		{"reject_string", `() => Promise.reject("RPC failure")`, true},
		{"resolve_getter_throw", `() => Promise.resolve({
			get value() { throw new Error("RPC failure"); }
		})`, true},
		{"reject_getter_throw", `() => Promise.reject({
			get value() { throw new Error("RPC failure"); }
		})`, true},
		{"reject_to_string_throw", `() => {
			const error = new Error("rejected");
			error.toString = () => { throw new Error("RPC failure"); };
			return Promise.reject(error);
		}`, true},
		{"then_throw", `() => {
			const promise = Promise.resolve(42);
			promise.then = () => { throw new Error("RPC failure"); };
			return promise;
		}`, true},
		{"then_twice", `() => {
			const promise = Promise.resolve(42);
			promise.then = (resolve) => { resolve(42); resolve(42); };
			return promise;
		}`, false},
	} {
		t.Run(entry.name, func(t *testing.T) {
			p := newRPCCancellationTestPlugin(t)
			rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
				value, err := rt.RunString(entry.script)
				if err != nil {
					return nil, err
				}
				method, _ := goja.AssertFunction(value)
				p.rpcMethods.Store("result", &RpcMethod{Method: method})
				return nil, nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			result, rpcError := p.callRpcMethod(ctx, "result", nil)
			if ctx.Err() != nil {
				t.Fatalf("RPC waited for context expiration instead of returning its result: %v", ctx.Err())
			}
			if entry.wantError {
				if rpcError == nil || rpcError.Code != JsonRpcErrorCodeInternalError || !strings.Contains(rpcError.Data.(string), "RPC failure") {
					t.Fatalf("unexpected script error: %#v", rpcError)
				}
			} else if rpcError != nil || result != int64(42) {
				t.Fatalf("unexpected script result: %v, %+v", result, rpcError)
			}
		})
	}
}
