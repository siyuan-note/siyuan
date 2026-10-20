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
	engine.POST("/api/import/prepareDataImport", prepareDataImport)
	engine.POST("/api/import/commitDataImport", commitDataImport)
	engine.POST("/api/import/cancelDataImport", cancelDataImport)
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
