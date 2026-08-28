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
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInsertLocalAssetsWithoutBlockID(t *testing.T) {
	originalConf, originalWorkspaceDir, originalDataDir := model.Conf, util.WorkspaceDir, util.DataDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		model.Conf = originalConf
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
	})

	assetPath := filepath.Join(util.DataDir, "assets", "pasted.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{
		"assetPaths": []string{assetPath},
		"isUpload":   true,
	})
	if err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodPost, "/api/asset/insertLocalAssets", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	insertLocalAssets(context)

	response := struct {
		Code int `json:"code"`
		Data struct {
			SuccFiles []model.AssetUploadSuccess `json:"succFiles"`
		} `json:"data"`
	}{}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 0 || len(response.Data.SuccFiles) != 1 ||
		response.Data.SuccFiles[0].Path != "assets/pasted.png" {
		t.Fatalf("unexpected insert local assets response: %s", recorder.Body.String())
	}
}

func TestAssetAdminEndpointsRejectReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	ServeAPI(engine)

	tests := []struct {
		path string
		body string
	}{
		{path: "/api/asset/resolveAssetPath", body: `{"path":"assets/test.png"}`},
		{path: "/api/asset/getUnusedAssets", body: `{}`},
		{path: "/api/asset/getMissingAssets", body: `{}`},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("reader request returned status %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
