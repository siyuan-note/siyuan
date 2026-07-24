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
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
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
