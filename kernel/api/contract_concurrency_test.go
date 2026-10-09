package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractJSONHTTP2Concurrency(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, scenario := range []string{"complete", "cancel", "trailing data"} {
		t.Run(scenario, func(t *testing.T) {
			firstRead := make(chan struct{})
			engine := gin.New()
			engine.Use(model.ControlConcurrency, func(c *gin.Context) {
				if c.GetHeader("X-Test-Request") == "first" {
					c.Request.Body = &putFileReadObserver{ReadCloser: c.Request.Body, started: firstRead}
				}
			})
			var writes sync.Map
			engine.POST(apicontract.SetLocalStorageVal.Definition().Path, contractHandler(apicontract.SetLocalStorageVal,
				func(c *gin.Context, request apicontract.StorageSetRequest) apicontract.Response[apicontract.Null] {
					writes.Store(c.GetHeader("X-Test-Request"), true)
					return apicontract.Success(apicontract.Null{})
				}))
			engine.POST(apicontract.GetLocalStorageVal.Definition().Path, contractHandler(apicontract.GetLocalStorageVal,
				func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[apicontract.JSONValue] {
					return apicontract.Success(apicontract.JSONValue{})
				}))
			server := httptest.NewUnstartedServer(engine)
			server.EnableHTTP2 = true
			server.StartTLS()
			client := server.Client()
			client.Timeout = 5 * time.Second
			ctx, cancel := context.WithCancel(context.Background())
			release := make(chan struct{})
			var once sync.Once
			releaseFirst := func() { once.Do(func() { close(release) }) }
			t.Cleanup(func() {
				cancel()
				releaseFirst()
				client.CloseIdleConnections()
				server.Close()
			})

			// 首个 JSON 暂停发送末尾；排队的大请求必须能接收完整数据并独立完成。
			firstBody := []byte(`{"key":"test","val":"` + strings.Repeat("a", 512*1024) + `"}`)
			if scenario == "trailing data" {
				firstBody = append(firstBody, bytes.Repeat([]byte(" "), 2*1024*1024)...)
			}
			firstReader := io.MultiReader(bytes.NewReader(firstBody[:len(firstBody)-16]), &putFilePausedReader{
				reader: bytes.NewReader(firstBody[len(firstBody)-16:]), release: release, context: ctx,
			})
			firstConn, secondConn, queryConn := make(chan net.Conn, 1), make(chan net.Conn, 1), make(chan net.Conn, 1)
			first := startContractJSONRequest(t, client, ctx, server.URL, "/api/storage/setLocalStorageVal", "first", firstReader, int64(len(firstBody)), firstConn)
			select {
			case <-firstRead:
			case <-time.After(3 * time.Second):
				t.Fatal("first request did not start reading")
			}
			secondBody := `{"key":"test","val":"` + strings.Repeat("b", 2*1024*1024) + `"}`
			second := startContractJSONRequest(t, client, context.Background(), server.URL, "/api/storage/setLocalStorageVal", "second", strings.NewReader(secondBody), int64(len(secondBody)), secondConn)
			awaitContractJSONRequest(t, second, "/api/storage/setLocalStorageVal")
			queryBody := `{"key":"test"}`
			query := startContractJSONRequest(t, client, context.Background(), server.URL, "/api/storage/getLocalStorageVal", "query", strings.NewReader(queryBody), int64(len(queryBody)), queryConn)
			awaitContractJSONRequest(t, query, "/api/storage/getLocalStorageVal")
			conn := <-firstConn
			if conn != <-secondConn || conn != <-queryConn {
				t.Fatal("requests did not share one HTTP/2 connection")
			}
			if _, ok := writes.Load("first"); ok {
				t.Fatal("first request wrote before its body was complete")
			}
			if scenario == "cancel" {
				cancel()
				select {
				case result := <-first:
					if result.err == nil {
						t.Fatal("cancelled request unexpectedly succeeded")
					}
				case <-time.After(3 * time.Second):
					t.Fatal("cancelled request did not finish")
				}
			} else {
				releaseFirst()
				awaitContractJSONRequest(t, first, "/api/storage/setLocalStorageVal")
			}
		})
	}
}

func startContractJSONRequest(t *testing.T, client *http.Client, ctx context.Context, origin, path, name string, body io.Reader, size int64, connections chan<- net.Conn) <-chan putFileUploadResult {
	t.Helper()
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
		connections <- info.Conn
	}})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+path, body)
	if err != nil {
		t.Fatal(err)
	}
	request.ContentLength = size
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Test-Request", name)
	return startPutFileUpload(client, request)
}

func awaitContractJSONRequest(t *testing.T, done <-chan putFileUploadResult, path string) {
	t.Helper()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.protocol != 2 {
			t.Fatalf("expected HTTP/2, got %d", result.protocol)
		}
		requireAPIContract(t, http.MethodPost, path, result.recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(result.recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("request failed: %s, %v", result.recorder.Body.String(), err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("request blocked while another request was receiving its body")
	}
}

func TestAPIContractJSONWriteSerialization(t *testing.T) {
	for _, cancelQueued := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "cancel queued"}[cancelQueued], func(t *testing.T) {
			firstCleanup, releaseCleanup, secondRead := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var once sync.Once
			release := func() { once.Do(func() { close(releaseCleanup) }) }
			t.Cleanup(release)
			engine := gin.New()
			engine.Use(model.ControlConcurrency, func(c *gin.Context) {
				c.Next()
				if c.GetHeader("X-Test-Request") == "first" {
					close(firstCleanup)
					<-releaseCleanup
				}
			})
			var writes sync.Map
			engine.POST("/api/storage/setLocalStorageVal", contractHandler(apicontract.SetLocalStorageVal,
				func(c *gin.Context, request apicontract.StorageSetRequest) apicontract.Response[apicontract.Null] {
					writes.Store(c.GetHeader("X-Test-Request"), true)
					return apicontract.Success(apicontract.Null{})
				}))
			firstRequest := httptest.NewRequest(http.MethodPost, "/api/storage/setLocalStorageVal", strings.NewReader(`{"key":"test","val":1}`))
			firstRequest.Header.Set("X-Test-Request", "first")
			first := serveContractConcurrencyRequest(engine, firstRequest)
			select {
			case <-firstCleanup:
			case <-time.After(3 * time.Second):
				t.Fatal("first request did not reach cleanup")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			secondRequest := httptest.NewRequest(http.MethodPost, "/api/storage/setLocalStorageVal", nil).WithContext(ctx)
			secondRequest.Header.Set("X-Test-Request", "second")
			secondRequest.Body = &contractEOFObserver{Reader: strings.NewReader(`{"key":"test","val":2}`), eof: secondRead}
			second := serveContractConcurrencyRequest(engine, secondRequest)
			select {
			case <-secondRead:
			case <-time.After(3 * time.Second):
				t.Fatal("queued body was not drained")
			}
			select {
			case <-second:
				t.Fatal("write completed before first response cleanup")
			case <-time.After(50 * time.Millisecond):
			}
			if cancelQueued {
				cancel()
			}
			release()
			for _, done := range []<-chan *httptest.ResponseRecorder{first, second} {
				select {
				case recorder := <-done:
					requireAPIContract(t, http.MethodPost, "/api/storage/setLocalStorageVal", recorder)
				case <-time.After(3 * time.Second):
					t.Fatal("request did not release its lock")
				}
			}
			if _, written := writes.Load("second"); written == cancelQueued {
				t.Fatalf("queued write executed=%t, cancelled=%t", written, cancelQueued)
			}
		})
	}
}

type contractEOFObserver struct {
	io.Reader
	eof  chan struct{}
	once sync.Once
}

func (r *contractEOFObserver) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err == io.EOF {
		r.once.Do(func() { close(r.eof) })
	}
	return n, err
}
func (r *contractEOFObserver) Close() error { return nil }

func serveContractConcurrencyRequest(engine *gin.Engine, request *http.Request) <-chan *httptest.ResponseRecorder {
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		done <- recorder
	}()
	return done
}

func TestAPIContractJSONAdmissionBeforeBody(t *testing.T) {
	oldConf, oldReadonly := model.Conf, util.ReadOnly
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf, util.ReadOnly = oldConf, oldReadonly })
	for _, scenario := range []struct {
		name     string
		role     model.Role
		readonly bool
		status   int
	}{
		{"unauthenticated", model.RoleVisitor, false, http.StatusUnauthorized},
		{"editor", model.RoleEditor, false, http.StatusForbidden},
		{"reader", model.RoleReader, false, http.StatusForbidden},
		{"readonly", model.RoleAdministrator, true, http.StatusOK},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			util.ReadOnly = scenario.readonly
			engine := gin.New()
			engine.Use(model.ControlConcurrency, func(c *gin.Context) { c.Set(model.RoleContextKey, scenario.role) })
			ServeAPI(engine)
			read := make(chan struct{})
			request := httptest.NewRequest(http.MethodPost, "/api/system/setUILayout", nil)
			request.Body = &putFileReadObserver{ReadCloser: io.NopCloser(strings.NewReader(`{"layout":{}}`)), started: read}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != scenario.status {
				t.Fatalf("unexpected status: %d", recorder.Code)
			}
			select {
			case <-read:
				t.Fatal("denied request body was read")
			default:
			}
		})
	}
}
