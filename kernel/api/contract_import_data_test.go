// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDataImportPrepareCancelAndInvalidCommit(t *testing.T) {
	oldConf, oldData, oldConfig, oldTemp, oldHistory := model.Conf, util.DataDir, util.ConfDir, util.TempDir, util.HistoryDir
	root := t.TempDir()
	util.DataDir, util.ConfDir, util.TempDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "conf"), filepath.Join(root, "temp"), filepath.Join(root, "history")
	for _, dir := range []string{util.DataDir, util.ConfDir, util.TempDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	t.Cleanup(func() {
		model.Conf, util.DataDir, util.ConfDir, util.TempDir, util.HistoryDir = oldConf, oldData, oldConfig, oldTemp, oldHistory
	})
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/import/prepareDataImport", model.CheckReadonly, prepareDataImport)
	engine.POST("/api/import/commitDataImport", model.CheckReadonly, commitDataImport)
	engine.POST("/api/import/cancelDataImport", model.CheckReadonly, cancelDataImport)
	var archive bytes.Buffer
	writer := archivezip.NewWriter(&archive)
	file, err := writer.Create("data/ordinary.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte("prepared only")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	upload, err := form.CreateFormFile("file", "data.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = upload.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/import/prepareDataImport", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
	var prepared struct {
		Code int                        `json:"code"`
		Data apicontract.DataImportPlan `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &prepared); err != nil || prepared.Code != 0 || prepared.Data.ID == "" ||
		prepared.Data.Conflicts == nil || prepared.Data.Encrypted == nil {
		t.Fatalf("invalid prepared response: %s %v", recorder.Body.String(), err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "ordinary.txt")); !os.IsNotExist(err) {
		t.Fatal("prepare wrote active data")
	}
	for _, input := range []string{
		`{"id":"../../outside","mode":"overwrite"}`,
		`{"id":"` + prepared.Data.ID + `","mode":"silent"}`,
		`{"id":"` + prepared.Data.ID + `","mode":null}`,
		`{"id":"` + prepared.Data.ID + `","mode":"skip","password":true}`,
	} {
		recorder = httptest.NewRecorder()
		request = httptest.NewRequest(http.MethodPost, "/api/import/commitDataImport", strings.NewReader(input))
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
		var response struct{ Code int }
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code == 0 {
			t.Fatalf("accepted invalid commit: %s", recorder.Body.String())
		}
	}
	stagePath := filepath.Join(util.ConfDir, "data-imports", prepared.Data.ID, "stage.json")
	stageData, err := os.ReadFile(stagePath)
	if err != nil {
		t.Fatal(err)
	}
	var stage map[string]any
	if err = json.Unmarshal(stageData, &stage); err != nil {
		t.Fatal(err)
	}
	stage["created"] = time.Now().Add(-time.Hour).Unix()
	stageData, err = json.Marshal(stage)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(stagePath, stageData, 0600); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/import/cancelDataImport", strings.NewReader(`{"id":" `+prepared.Data.ID+` "}`))
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
	var canceled struct{ Code int }
	if err = json.Unmarshal(recorder.Body.Bytes(), &canceled); err != nil || canceled.Code != 0 {
		t.Fatalf("cancel failed: %s", recorder.Body.String())
	}
	if _, err = os.Stat(filepath.Join(util.ConfDir, "data-imports", prepared.Data.ID)); !os.IsNotExist(err) {
		t.Fatal("cancel retained staging files")
	}
}

func TestAPIContractDataImportAuthorization(t *testing.T) {
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		for _, endpoint := range []string{"prepareDataImport", "commitDataImport", "cancelDataImport"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/import/"+endpoint, strings.NewReader(`{}`)))
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("role %v reached %s: %s", role, endpoint, recorder.Body.String())
			}
		}
	}
}
