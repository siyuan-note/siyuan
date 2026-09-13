package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExtensionCopy(t *testing.T) {
	for _, test := range []struct {
		name, dom                                    string
		missing, malformed, brokenUpload, blockedDir bool
	}{
		{name: "text", dom: "<p>Hello</p>"},
		{name: "empty DOM"},
		{name: "missing DOM", missing: true},
		{name: "malformed form", malformed: true},
		{name: "failed upload retains markdown", dom: "<p>Hello</p>", brokenUpload: true},
		{name: "asset directory failure", dom: "<p>Hello</p>", blockedDir: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			assets := setupAssetContractWorkspace(t)
			if test.blockedDir {
				if err := os.Remove(assets); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(assets, []byte("occupied"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			if !test.missing {
				if err := writer.WriteField("dom", test.dom); err != nil {
					t.Fatal(err)
				}
				if err := writer.WriteField("dom", "<p>ignored second value</p>"); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/api/extension/copy", &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			if test.malformed {
				request = httptest.NewRequest("POST", "/api/extension/copy", strings.NewReader("invalid"))
			}
			if test.brokenUpload {
				if err := request.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				request.MultipartForm.File = map[string][]*multipart.FileHeader{"https://example.invalid/image.png": {{Filename: "missing.png", Size: 1}}}
			}
			engine := gin.New()
			engine.POST("/api/extension/copy", extensionCopy)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/extension/copy", recorder)
			var response struct {
				Code int                            `json:"code"`
				Msg  string                         `json:"msg"`
				Data *apicontract.ExtensionCopyData `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if test.missing || test.malformed {
				if recorder.Body.String() != `{"code":0,"msg":"","data":null}` {
					t.Fatalf("empty response changed: %s", recorder.Body.String())
				}
				return
			}
			if test.blockedDir {
				if response.Code != 0 || response.Msg == "" || response.Data != nil {
					t.Fatalf("directory failure changed: %+v", response)
				}
				return
			}
			wantCode := 0
			if test.brokenUpload {
				wantCode = -1
			}
			if response.Code != wantCode || response.Msg != model.Conf.Language(72) || response.Data == nil || response.Data.WithMath {
				t.Fatalf("clip response changed: %+v", response)
			}
			if test.dom != "" && (!strings.Contains(response.Data.Markdown, "Hello") || strings.Contains(response.Data.Markdown, "ignored")) {
				t.Fatalf("DOM selection changed: %s", response.Data.Markdown)
			}
			if _, err := os.Stat(filepath.Dir(assets)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAPIContractExtensionLockedNotebook(t *testing.T) {
	setupAssetContractWorkspace(t)
	const boxID = "20260913000000-extlock"
	box := conf.NewBoxConf()
	box.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(box); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range [][2]string{{"dom", "<p>private clip</p>"}, {"notebook", boxID}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/extension/copy", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/extension/copy", extensionCopy)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/extension/copy", recorder)
	if recorder.Body.String() != `{"code":-1,"msg":"encrypted notebook is locked, please unlock it first","data":null}` {
		t.Fatalf("locked notebook admission changed: %s", recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, boxID, "assets")); !os.IsNotExist(err) {
		t.Fatalf("locked notebook assets were accessed: %v", err)
	}
}
