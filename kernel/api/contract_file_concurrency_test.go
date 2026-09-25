package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPutFileHTTP2ConcurrentUploads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, cancelFirst := range []bool{false, true} {
		name := "complete paused upload"
		if cancelFirst {
			name = "cancel paused upload"
		}
		t.Run(name, func(t *testing.T) {
			originalWorkspace, originalData := util.WorkspaceDir, util.DataDir
			util.WorkspaceDir = t.TempDir()
			util.DataDir = filepath.Join(util.WorkspaceDir, "data")
			t.Cleanup(func() { util.WorkspaceDir, util.DataDir = originalWorkspace, originalData })

			firstRead, firstHandled := make(chan struct{}), make(chan struct{})
			engine := gin.New()
			engine.Use(model.ControlConcurrency, func(c *gin.Context) {
				c.Set(model.RoleContextKey, model.RoleAdministrator)
				if c.GetHeader("X-Test-Upload") == "first" {
					c.Request.Body = &putFileReadObserver{ReadCloser: c.Request.Body, started: firstRead}
					defer close(firstHandled)
				}
				c.Next()
			})
			ServeAPI(engine)
			server := httptest.NewUnstartedServer(engine)
			server.EnableHTTP2 = true
			server.StartTLS()
			client := server.Client()
			client.Timeout = 5 * time.Second
			ctx, cancel := context.WithCancel(context.Background())
			release := make(chan struct{})
			var releaseOnce sync.Once
			releaseFirst := func() { releaseOnce.Do(func() { close(release) }) }
			t.Cleanup(func() {
				cancel()
				releaseFirst()
				client.CloseIdleConnections()
				server.Close()
			})

			const target = "temp/concurrent-upload.json"
			firstContent := []byte(`{"upload":"first"}`)
			firstBody, firstMedia := putFileMultipartBody(t, target, firstContent)
			// 首个请求已开始在内核接收，但暂不发送表单末尾，第二个上传必须能独立接收和写入。
			firstReader := io.MultiReader(bytes.NewReader(firstBody[:len(firstBody)-16]), &putFilePausedReader{
				reader: bytes.NewReader(firstBody[len(firstBody)-16:]), release: release, context: ctx,
			})
			firstConnections, secondConnections := make(chan net.Conn, 1), make(chan net.Conn, 1)
			first := putFileUploadRequest(t, ctx, server.URL, firstMedia, firstReader, firstConnections)
			first.Header.Set("X-Test-Upload", "first")
			firstDone := startPutFileUpload(client, first)
			select {
			case <-firstRead:
			case <-time.After(3 * time.Second):
				t.Fatal("first upload did not start reading its body")
			}

			// 文件大于 HTTP/2 默认连接接收窗口，覆盖排队上传占满窗口的情况。
			secondContent := bytes.Repeat([]byte("b"), 2*1024*1024)
			secondBody, secondMedia := putFileMultipartBody(t, target, secondContent)
			second := putFileUploadRequest(t, context.Background(), server.URL, secondMedia, bytes.NewReader(secondBody), secondConnections)
			secondDone := startPutFileUpload(client, second)
			assertPutFileUpload(t, secondDone)
			if <-firstConnections != <-secondConnections {
				t.Fatal("uploads did not share one HTTP/2 connection")
			}
			filePath := filepath.Join(util.WorkspaceDir, target)
			assertPutFileContent(t, filePath, secondContent)

			if cancelFirst {
				cancel()
				select {
				case result := <-firstDone:
					if result.err == nil {
						t.Fatal("cancelled upload unexpectedly succeeded")
					}
				case <-time.After(3 * time.Second):
					t.Fatal("cancelled upload did not finish")
				}
				// 等待服务端处理完取消，确认不完整上传没有覆盖已经成功写入的数据。
				select {
				case <-firstHandled:
				case <-time.After(3 * time.Second):
					t.Fatal("server did not finish the cancelled upload")
				}
				assertPutFileContent(t, filePath, secondContent)
			} else {
				releaseFirst()
				assertPutFileUpload(t, firstDone)
				assertPutFileContent(t, filePath, firstContent)
			}
		})
	}
}

func TestAPIContractPutFileAuthorizationBeforeBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalConf, originalReadonly := model.Conf, util.ReadOnly
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf, util.ReadOnly = originalConf, originalReadonly })
	for _, entry := range []struct {
		name     string
		role     model.Role
		readonly bool
		status   int
	}{
		{"editor", model.RoleEditor, false, http.StatusForbidden},
		{"reader", model.RoleReader, false, http.StatusForbidden},
		{"readonly kernel", model.RoleAdministrator, true, http.StatusOK},
	} {
		t.Run(entry.name, func(t *testing.T) {
			util.ReadOnly = entry.readonly
			engine := gin.New()
			engine.Use(model.ControlConcurrency, func(c *gin.Context) {
				c.Set(model.RoleContextKey, entry.role)
				c.Next()
			})
			ServeAPI(engine)
			read := make(chan struct{})
			request := httptest.NewRequest(http.MethodPost, "/api/file/putFile", nil)
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			request.Body = &putFileReadObserver{ReadCloser: io.NopCloser(bytes.NewReader(nil)), started: read}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != entry.status {
				t.Fatalf("unexpected admission status: %d %s", recorder.Code, recorder.Body.String())
			}
			select {
			case <-read:
				t.Fatal("unauthorized upload body was read")
			default:
			}
			if entry.readonly {
				requireAPIContract(t, http.MethodPost, "/api/file/putFile", recorder)
				var response struct {
					Code int `json:"code"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
					t.Fatalf("readonly admission changed: %s, %v", recorder.Body.String(), err)
				}
			}
		})
	}
}

type putFileReadObserver struct {
	io.ReadCloser
	started chan struct{}
	once    sync.Once
}

func (r *putFileReadObserver) Read(p []byte) (int, error) {
	r.once.Do(func() { close(r.started) })
	return r.ReadCloser.Read(p)
}

type putFilePausedReader struct {
	reader  io.Reader
	release <-chan struct{}
	context context.Context
}

func (r *putFilePausedReader) Read(p []byte) (int, error) {
	select {
	case <-r.release:
		return r.reader.Read(p)
	case <-r.context.Done():
		return 0, r.context.Err()
	}
}

type putFileUploadResult struct {
	recorder *httptest.ResponseRecorder
	protocol int
	err      error
}

func startPutFileUpload(client *http.Client, request *http.Request) <-chan putFileUploadResult {
	done := make(chan putFileUploadResult, 1)
	go func() {
		result := putFileUploadResult{}
		response, err := client.Do(request)
		if err != nil {
			result.err = err
		} else {
			defer response.Body.Close()
			result.protocol = response.ProtoMajor
			result.recorder = httptest.NewRecorder()
			for key, values := range response.Header {
				result.recorder.Header()[key] = values
			}
			result.recorder.Code = response.StatusCode
			_, result.err = io.Copy(result.recorder.Body, response.Body)
		}
		done <- result
	}()
	return done
}

func putFileUploadRequest(t *testing.T, ctx context.Context, origin, media string, body io.Reader, connections chan<- net.Conn) *http.Request {
	t.Helper()
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
		connections <- info.Conn
	}})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/api/file/putFile", body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", media)
	return request
}

func putFileMultipartBody(t *testing.T, path string, content []byte) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("path", path); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "upload.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

func assertPutFileUpload(t *testing.T, done <-chan putFileUploadResult) {
	t.Helper()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.protocol != 2 {
			t.Fatalf("expected HTTP/2, got HTTP/%d", result.protocol)
		}
		requireAPIContract(t, http.MethodPost, "/api/file/putFile", result.recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(result.recorder.Body.Bytes(), &response); err != nil || result.recorder.Code != http.StatusOK || response.Code != 0 {
			t.Fatalf("upload failed: %d %s, %v", result.recorder.Code, result.recorder.Body.String(), err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("upload blocked while another request was receiving its body")
	}
}

func assertPutFileContent(t *testing.T, path string, expected []byte) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(content, expected) {
		t.Fatalf("uploaded content mismatch: got %d bytes, want %d bytes", len(content), len(expected))
	}
}
