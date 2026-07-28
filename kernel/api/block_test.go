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

func TestFilterBlockIDsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260724000000-boxid01"
		publicID          = "20260724000001-public1"
		hiddenID          = "20260724000002-hidden1"
		protectedID       = "20260724000003-protect"
		missingID         = "20260724000004-missing"
		protectedPassword = "password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: hiddenID, Disable: true},
		{ID: protectedID, Visible: true, Password: protectedPassword},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
	})

	for _, id := range []string{publicID, hiddenID, protectedID} {
		treenode.IndexBlockTree(&parse.Tree{
			ID:   id,
			Box:  boxID,
			Path: "/" + id + ".sy",
			Root: &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}

	ids := []string{publicID, hiddenID, protectedID, missingID}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Set(model.RoleContextKey, model.RoleReader)
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, []string{publicID}) {
		t.Fatalf("unexpected unauthenticated reader block IDs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, []string{publicID, protectedID}) {
		t.Fatalf("unexpected authenticated reader block IDs: %v", filtered)
	}

	c.Set(model.RoleContextKey, model.RoleAdministrator)
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, ids) {
		t.Fatalf("administrator block IDs should remain unchanged: %v", filtered)
	}
}

func TestGetBlocksOrdersArguments(t *testing.T) {
	tests := []struct {
		name         string
		body         string
		expectedCode int
		expectEmpty  bool
	}{
		{name: "missing mode", body: `{}`, expectedCode: -1},
		{
			name:         "mutually exclusive modes",
			body:         `{"id":"20260728000200-doc0001","ids":[]}`,
			expectedCode: -1,
		},
		{name: "empty IDs", body: `{"ids":[]}`, expectedCode: 0, expectEmpty: true},
		{name: "invalid IDs are ignored", body: `{"ids":["invalid"]}`, expectedCode: 0, expectEmpty: true},
		{name: "non-string ID", body: `{"ids":[1]}`, expectedCode: -1},
		{name: "wrong document ID type", body: `{"id":1}`, expectedCode: -1},
		{name: "invalid document ID", body: `{"id":"invalid"}`, expectedCode: -1},
		{name: "null document ID", body: `{"id":null}`, expectedCode: -1},
		{name: "null IDs", body: `{"ids":null}`, expectedCode: -1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := postBlocksOrders(t, test.body)
			if test.expectedCode != response.Code {
				t.Fatalf("unexpected response code: expected %d, got %d, message %q",
					test.expectedCode, response.Code, response.Msg)
			}
			if test.expectEmpty {
				var ids []string
				if err := json.Unmarshal(response.Data, &ids); err != nil {
					t.Fatalf("unmarshal block orders failed: %v", err)
				}
				if nil == ids || 0 != len(ids) {
					t.Fatalf("expected an empty non-nil block order list, got %v", ids)
				}
			}
		})
	}
}

type blocksOrdersResponse struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func postBlocksOrders(t *testing.T, body string) *blocksOrdersResponse {
	t.Helper()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	engine.POST("/api/block/getBlocksOrders", getBlocksOrders)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/block/getBlocksOrders", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &blocksOrdersResponse{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	return response
}
