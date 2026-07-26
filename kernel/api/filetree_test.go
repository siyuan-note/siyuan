// SiYuan - Refactor your thinking
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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetSortRejectsInvalidRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/setSort", setSort)

	tests := []struct {
		name string
		body string
	}{
		{name: "empty", body: `{}`},
		{name: "null item", body: `{"docSorts":[null]}`},
		{name: "invalid ID", body: `{"docSorts":[{"id":"invalid","sort":0}]}`},
		{name: "missing sort", body: `{"docSorts":[{"id":"20260718000001-abcdefg"}]}`},
		{name: "fractional sort", body: `{"docSorts":[{"id":"20260718000001-abcdefg","sort":1.5}]}`},
		{name: "duplicate ID", body: `{"docSorts":[{"id":"20260718000001-abcdefg","sort":0},{"id":"20260718000001-abcdefg","sort":1}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/filetree/setSort", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("invalid request returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
}

func TestPublishAccessConfigurationRejectsEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID = "20260726000000-encrypt"
		docID = "20260726000001-encrypt"
	)
	oldDataDir := util.DataDir
	oldPublishAccess := model.PublishAccess{}
	if oldDataDir != "" {
		oldPublishAccess = model.GetPublishAccess()
	}
	oldConf := model.Conf
	oldLangs := util.Langs
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {313: "Encrypted notebooks do not support this operation"},
		"en":   {313: "Encrypted notebooks do not support this operation"},
	}
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		model.Conf = oldConf
		util.Langs = oldLangs
		if oldDataDir != "" {
			if err := model.SetPublishAccess(oldPublishAccess); err != nil {
				t.Errorf("restore publish access failed: %v", err)
			}
		}
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, docID+".sy"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/filetree/setPublishAccess", setPublishAccess)
	engine.POST("/api/filetree/getPublishAccess", getPublishAccess)
	engine.POST("/api/filetree/authFilePublishAccess", authFilePublishAccess)
	tests := []struct {
		name string
		path string
		body string
	}{
		{
			name: "set",
			path: "/api/filetree/setPublishAccess",
			body: `{"id":"` + boxID + `","visible":true,"password":"","disable":false}`,
		},
		{
			name: "get",
			path: "/api/filetree/getPublishAccess",
			body: `{"ids":["` + boxID + `"]}`,
		},
		{
			name: "authenticate",
			path: "/api/filetree/authFilePublishAccess",
			body: `{"id":"` + boxID + `","password":""}`,
		},
		{
			name: "set locked document",
			path: "/api/filetree/setPublishAccess",
			body: `{"id":"` + docID + `","visible":true,"password":"","disable":false}`,
		},
		{
			name: "get locked document",
			path: "/api/filetree/getPublishAccess",
			body: `{"ids":["` + docID + `"]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("encrypted notebook publish access returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
	if len(model.GetPublishAccess()) != 0 {
		t.Fatal("encrypted notebook publish access should not be persisted")
	}
}

func TestPublishReaderCannotBrowseEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID = "20260726000000-encrypt"
		docID = "20260726000001-encrypt"
	)
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/filetree/listDocsByPath", listDocsByPath)
	engine.POST("/api/filetree/getDoc", getDoc)

	listRecorder := httptest.NewRecorder()
	listRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/filetree/listDocsByPath",
		strings.NewReader(`{"notebook":"`+boxID+`","path":"/"}`),
	)
	listRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(listRecorder, listRequest)

	listResponse := &struct {
		Code int `json:"code"`
		Data struct {
			Files []any `json:"files"`
		} `json:"data"`
	}{}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), listResponse); err != nil {
		t.Fatalf("unmarshal list response failed: %v", err)
	}
	if listResponse.Code != 0 || len(listResponse.Data.Files) != 0 {
		t.Fatalf("publish reader enumerated encrypted notebook: %s", listRecorder.Body.String())
	}

	docRecorder := httptest.NewRecorder()
	docRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/filetree/getDoc",
		strings.NewReader(`{"id":"`+docID+`","notebook":"`+boxID+`"}`),
	)
	docRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(docRecorder, docRequest)

	docResponse := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(docRecorder.Body.Bytes(), docResponse); err != nil {
		t.Fatalf("unmarshal document response failed: %v", err)
	}
	if docResponse.Code != 3 {
		t.Fatalf("publish reader accessed encrypted document: %s", docRecorder.Body.String())
	}
}

func TestFilterFileTreePublishAccess(t *testing.T) {
	const (
		boxID             = "20260725000000-boxid01"
		publicID          = "20260725000001-public1"
		protectedID       = "20260725000002-protect"
		hiddenID          = "20260725000003-hidden1"
		privateID         = "20260725000004-private"
		forbiddenID       = "20260725000005-forbid1"
		missingID         = "20260725000006-missing"
		privatePassword   = "private-password"
		protectedPassword = "protected-password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: privateID, Visible: false, Password: privatePassword},
		{ID: forbiddenID, Visible: false, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
	})

	ids := []string{publicID, protectedID, hiddenID, privateID, forbiddenID}
	allIDs := append(slices.Clone(ids), missingID)
	for _, id := range ids {
		treenode.IndexBlockTree(&parse.Tree{
			ID:    id,
			Box:   boxID,
			Path:  "/" + id + ".sy",
			HPath: "/" + id,
			Root:  &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}

	paths := []string{
		"/" + publicID + ".sy",
		"/" + protectedID + ".sy",
		"/" + hiddenID + ".sy",
		"/" + privateID + ".sy",
		"/" + forbiddenID + ".sy",
		"/" + missingID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Set(model.RoleContextKey, model.RoleReader)

	expectedPaths := paths[:3]
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, expectedPaths) {
		t.Fatalf("unexpected unauthenticated reader paths: %v", filtered)
	}
	expectedIDs := []string{publicID, protectedID}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("unexpected reader discoverable IDs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePassword)),
	})
	expectedPaths = paths[:4]
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, expectedPaths) {
		t.Fatalf("unexpected authenticated reader paths: %v", filtered)
	}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("private documents should remain undiscoverable: %v", filtered)
	}

	c.Set(model.RoleContextKey, model.RoleAdministrator)
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, paths) {
		t.Fatalf("administrator paths should remain unchanged: %v", filtered)
	}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, allIDs) {
		t.Fatalf("administrator IDs should remain unchanged: %v", filtered)
	}
}
