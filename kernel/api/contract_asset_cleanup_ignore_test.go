// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetCleanupIgnoreContract(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	if err := os.WriteFile(filepath.Join(assets, "sample.txt"), []byte("sample"), 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/asset/getAssetCleanupIgnore", getAssetCleanupIgnore)
	engine.POST("/api/asset/setAssetCleanupIgnore", setAssetCleanupIgnore)
	engine.POST("/api/asset/addAssetCleanupIgnore", addAssetCleanupIgnore)
	call := func(endpoint, body string, code int) apicontract.AssetCleanupIgnoreData {
		t.Helper()
		path := "/api/asset/" + endpoint
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int
			Data apicontract.AssetCleanupIgnoreData
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != code {
			t.Fatalf("%s: %s (%v)", endpoint, recorder.Body.String(), err)
		}
		return response.Data
	}
	read := call("getAssetCleanupIgnore", "", 0)
	if read.Content != "" || read.Revision == "" {
		t.Fatalf("missing file: %+v", read)
	}
	body, _ := json.Marshal(apicontract.SetAssetCleanupIgnoreRequest{Content: "# keep comments\r\n*.png\r\n", ExpectedRevision: read.Revision})
	written := call("setAssetCleanupIgnore", string(body), 0)
	if written.Content != "# keep comments\r\n*.png\r\n" || written.Revision == read.Revision {
		t.Fatalf("save: %+v", written)
	}
	call("setAssetCleanupIgnore", string(body), 409)
	if current := call("getAssetCleanupIgnore", "", 0); current != written {
		t.Fatalf("conflict overwrote file: %+v", current)
	}
	added := call("addAssetCleanupIgnore", `{"paths":["assets/sample.txt"]}`, 0)
	if !strings.HasPrefix(added.Content, written.Content) || added.Revision == written.Revision {
		t.Fatalf("append lost content: %+v", added)
	}
	if again := call("addAssetCleanupIgnore", `{"paths":["assets/sample.txt"]}`, 0); again != added {
		t.Fatalf("append was not idempotent: %+v", again)
	}
	for _, body := range []string{`{}`, `{"content":null,"expectedRevision":"x"}`, `{"content":""}`, `{"content":"","expectedRevision":null}`} {
		call("setAssetCleanupIgnore", body, -1)
	}
	for _, body := range []string{`{}`, `{"paths":null}`, `{"paths":[null]}`, `{"paths":["../outside"]}`} {
		call("addAssetCleanupIgnore", body, -1)
	}
	if current := call("getAssetCleanupIgnore", "", 0); current != added {
		t.Fatalf("invalid input changed rules: %+v", current)
	}
}

func TestAssetUploadCleanupIgnoreContract(t *testing.T) {
	for _, flag := range []string{"omitted", "false", "true", "", "TRUE", "1"} {
		t.Run(flag, func(t *testing.T) {
			assets := setupAssetContractWorkspace(t)
			content := []byte("protected upload fixture " + flag)
			name := "sample-20260101000000-abcdefg.txt"
			if err := os.WriteFile(filepath.Join(assets, name), content, 0644); err != nil {
				t.Fatal(err)
			}
			hash, err := util.GetEtagByHandle(bytes.NewReader(content), int64(len(content)))
			if err != nil {
				t.Fatal(err)
			}
			cache.SetAssetHash(hash, "assets/"+name)
			t.Cleanup(func() { cache.RemoveAssetHash(hash) })
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file[]", "sample.txt")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = part.Write(content); err != nil {
				t.Fatal(err)
			}
			if flag != "omitted" {
				if err = writer.WriteField("excludeFromCleanup", flag); err != nil {
					t.Fatal(err)
				}
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			engine := gin.New()
			engine.POST("/api/asset/upload", uploadAsset)
			request := httptest.NewRequest("POST", "/api/asset/upload", &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/asset/upload", recorder)
			var response struct {
				Code int
				Data apicontract.AssetUploadData
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			valid := flag == "omitted" || flag == "false" || flag == "true"
			if valid && (response.Code != 0 || len(response.Data.SuccFiles) != 1 || response.Data.SuccFiles[0].Path != "assets/"+name) {
				t.Fatalf("upload failed: %s", recorder.Body.String())
			}
			if !valid && (response.Code != -1 || len(response.Data.SuccFiles) != 0) {
				t.Fatalf("invalid flag accepted: %s", recorder.Body.String())
			}
			rules, err := model.GetAssetCleanupIgnore()
			if err != nil {
				t.Fatal(err)
			}
			if flag == "true" {
				if !strings.Contains(rules.Content, name) {
					t.Fatalf("reused upload not protected: %+v", rules)
				}
			} else if rules.Content != "" {
				t.Fatalf("unrequested protection: %+v", rules)
			}
		})
	}
}

func TestAssetCleanupIgnoreContractAuthorization(t *testing.T) {
	setupAssetContractWorkspace(t)
	oldReadonly := util.ReadOnly
	oldBypass := util.SiYuanAccessAuthCodeBypass
	util.SiYuanAccessAuthCodeBypass = false
	t.Cleanup(func() { util.ReadOnly, util.SiYuanAccessAuthCodeBypass = oldReadonly, oldBypass })
	for _, endpoint := range []string{"getAssetCleanupIgnore", "setAssetCleanupIgnore", "addAssetCleanupIgnore"} {
		for _, role := range []model.Role{model.RoleVisitor, model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
			util.ReadOnly = role == model.RoleAdministrator
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
			ServeAPI(engine)
			path := "/api/asset/" + endpoint
			request := httptest.NewRequest("POST", path, nil)
			request.Header.Set("Sec-Fetch-Site", "cross-site")
			if endpoint != "getAssetCleanupIgnore" || role != model.RoleAdministrator {
				request.Body = aiUnreadBody{t: t}
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			wantStatus := http.StatusForbidden
			if role == model.RoleVisitor {
				wantStatus = http.StatusUnauthorized
			}
			if role == model.RoleAdministrator {
				wantStatus = http.StatusOK
			}
			if recorder.Code != wantStatus {
				t.Fatalf("%s role %v: %d %s", endpoint, role, recorder.Code, recorder.Body.String())
			}
			if role == model.RoleAdministrator {
				requireAPIContract(t, "POST", path, recorder)
				wantCode := `"code":-1`
				if endpoint == "getAssetCleanupIgnore" {
					wantCode = `"code":0`
				}
				if !strings.Contains(recorder.Body.String(), wantCode) {
					t.Fatalf("read-only permission: %s", recorder.Body.String())
				}
			}
		}
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, ".siyuan", "assets-cleanup-ignore")); !os.IsNotExist(err) {
		t.Fatalf("denied write created file: %v", err)
	}
}
