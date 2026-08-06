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

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseBlockRefStringArrayEmptyHandling(t *testing.T) {
	arg := map[string]any{"ids": []any{}}

	requiredResult := gulu.Ret.NewResult()
	if _, ok := parseBlockRefStringArray(arg, "ids", requiredResult, true); ok || requiredResult.Code != -1 {
		t.Fatalf("expected an empty required array to be rejected, got code %d", requiredResult.Code)
	}

	optionalResult := gulu.Ret.NewResult()
	values, ok := parseBlockRefStringArray(arg, "ids", optionalResult, false)
	if !ok || optionalResult.Code != 0 || len(values) != 0 {
		t.Fatalf("expected an empty optional array to be accepted, got code %d and values %v", optionalResult.Code, values)
	}
}

func TestCheckBlockRefRejectsDeletedIDsOutsideIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/block/checkBlockRef", checkBlockRef)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/block/checkBlockRef", strings.NewReader(
		`{"scope":"blocks","ids":["20260804000000-checked"],"deletedIDs":["20260804000001-deleted"]}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); nil != err {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if -1 != int(response["code"].(float64)) ||
		"Field [deletedIDs] should be a subset of field [ids]" != response["msg"] {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestFilterBlockAndRefIDsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260724000000-boxid01"
		publicID          = "20260724000001-public1"
		hiddenID          = "20260724000002-hidden1"
		protectedID       = "20260724000003-protect"
		disabledID        = "20260724000004-disable"
		missingID         = "20260724000005-missing"
		protectedPassword = "password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: hiddenID, Visible: false},
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: disabledID, Visible: true, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
	})

	for _, id := range []string{publicID, hiddenID, protectedID, disabledID} {
		treenode.IndexBlockTree(&parse.Tree{
			ID:   id,
			Box:  boxID,
			Path: "/" + id + ".sy",
			Root: &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}

	ids := []string{publicID, hiddenID, protectedID, disabledID, missingID}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Set(model.RoleContextKey, model.RoleReader)
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, []string{publicID, hiddenID}) {
		t.Fatalf("unexpected unauthenticated reader block IDs: %v", filtered)
	}
	publishAccess := model.GetPublishAccess()
	if filtered := model.FilterRefIDsByPublishAccess(c, publishAccess, ids); !slices.Equal(filtered, []string{publicID}) {
		t.Fatalf("unexpected unauthenticated reader reference IDs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, []string{publicID, hiddenID, protectedID}) {
		t.Fatalf("unexpected authenticated reader block IDs: %v", filtered)
	}
	if filtered := model.FilterRefIDsByPublishAccess(c, publishAccess, ids); !slices.Equal(filtered, []string{publicID, protectedID}) {
		t.Fatalf("unexpected authenticated reader reference IDs: %v", filtered)
	}

	c.Set(model.RoleContextKey, model.RoleAdministrator)
	if filtered := filterBlockIDsByPublishAccess(c, ids, ""); !slices.Equal(filtered, ids) {
		t.Fatalf("administrator block IDs should remain unchanged: %v", filtered)
	}
}

func TestGetBlockInfoPublishAccess(t *testing.T) {
	const (
		boxID             = "20260806000020-box0020"
		protectedID       = "20260806000021-protect"
		privateID         = "20260806000022-private"
		privateChildID    = "20260806000023-child20"
		disabledID        = "20260806000024-disable"
		protectedPassword = "protected-password"
		privatePassword   = "private-password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: privateID, Visible: false, Password: privatePassword},
		{ID: disabledID, Visible: true, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
	})

	for _, id := range []string{protectedID, disabledID} {
		treenode.IndexBlockTree(&parse.Tree{
			ID:   id,
			Box:  boxID,
			Path: "/" + id + ".sy",
			Root: &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}
	privateRoot := &ast.Node{ID: privateID, Type: ast.NodeDocument}
	privateRoot.AppendChild(&ast.Node{ID: privateChildID, Type: ast.NodeParagraph})
	treenode.IndexBlockTree(&parse.Tree{
		ID:   privateID,
		Box:  boxID,
		Path: "/" + privateID + ".sy",
		Root: privateRoot,
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Set(model.RoleContextKey, model.RoleReader)

	_, passwordRequired, metadataVisible, accessible := getBlockInfoPublishAccess(c, protectedID, "")
	if !passwordRequired || !metadataVisible || !accessible {
		t.Fatalf("protected document gate = [%v, %v, %v], want password required with visible metadata",
			passwordRequired, metadataVisible, accessible)
	}

	_, passwordRequired, metadataVisible, accessible = getBlockInfoPublishAccess(c, privateID, "")
	if !passwordRequired || metadataVisible || !accessible {
		t.Fatalf("private document gate = [%v, %v, %v], want password required without visible metadata",
			passwordRequired, metadataVisible, accessible)
	}

	_, _, _, accessible = getBlockInfoPublishAccess(c, privateChildID, "")
	if accessible {
		t.Fatal("private child block should not open the password gate before authorization")
	}

	_, _, _, accessible = getBlockInfoPublishAccess(c, disabledID, "")
	if accessible {
		t.Fatal("publish-disabled document should not open the password gate")
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePassword)),
	})
	_, passwordRequired, metadataVisible, accessible = getBlockInfoPublishAccess(c, privateChildID, "")
	if passwordRequired || !metadataVisible || !accessible {
		t.Fatalf("authorized private child gate = [%v, %v, %v], want normal access",
			passwordRequired, metadataVisible, accessible)
	}
}

func TestGetDocBlocksOrdersArguments(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing document ID", body: `{}`},
		{name: "IDs only", body: `{"ids":[]}`},
		{name: "wrong document ID type", body: `{"id":1}`},
		{name: "invalid document ID", body: `{"id":"invalid"}`},
		{name: "null document ID", body: `{"id":null}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := postDocBlocksOrders(t, test.body)
			if -1 != response.Code {
				t.Fatalf("unexpected response code: expected -1, got %d, message %q", response.Code, response.Msg)
			}
		})
	}
}

type docBlocksOrdersResponse struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func TestBlockPublishAccessGuards(t *testing.T) {
	const (
		boxID             = "20260724000000-boxid03"
		publicID          = "20260724000020-public3"
		disabledID        = "20260724000021-disable"
		protectedID       = "20260724000022-protect"
		protectedPassword = "password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: disabledID, Visible: true, Disable: true},
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

	for _, id := range []string{publicID, disabledID, protectedID} {
		treenode.IndexBlockTree(&parse.Tree{
			ID:   id,
			Box:  boxID,
			Path: "/" + id + ".sy",
			Root: &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}

	blockGuardRequest := func(role any, body string, handler gin.HandlerFunc) map[string]any {
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/block/block", handler)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/block/block", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("unmarshal response failed: %v", err)
		}
		return response
	}

	t.Run("reader", func(t *testing.T) {
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+disabledID+`"}`, checkBlockExist); response["data"].(bool) {
			t.Fatalf("disabled block should be hidden from the reader, got %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+publicID+`"}`, checkBlockExist); !response["data"].(bool) {
			t.Fatalf("public block should be visible to the reader, got %v", response["data"])
		}
		response := blockGuardRequest(model.RoleReader, `{"ids":["`+publicID+`","`+disabledID+`"]}`, checkBlocksExist)
		if !response["data"].(map[string]any)[publicID].(bool) {
			t.Fatalf("unexpected block existence for the reader: %v", response["data"])
		}
		if _, exists := response["data"].(map[string]any)[disabledID]; exists {
			t.Fatalf("disabled block existence should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+disabledID+`"}`, checkBlockFold); response["data"].(map[string]any)["isFolded"].(bool) ||
			response["data"].(map[string]any)["isRoot"].(bool) {
			t.Fatalf("fold state of a disabled block should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+disabledID+`"}`, getUnfoldedParentID); "" != response["data"].(map[string]any)["parentID"].(string) {
			t.Fatalf("unfolded parent of a disabled block should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+disabledID+`"}`, getBlockIndex); 0 != int(response["data"].(float64)) {
			t.Fatalf("index of a disabled block should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"id":"`+disabledID+`"}`, getTreeStat); nil != response["data"].(map[string]any)["stat"] {
			t.Fatalf("tree stat of a disabled block should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"ids":["`+publicID+`","`+disabledID+`"]}`, getBlocksWordCount); 0 != int(response["code"].(float64)) {
			t.Fatalf("word count of disabled blocks should not error, got %v", response)
		}
		if response := blockGuardRequest(model.RoleReader, `{"ids":["`+publicID+`","`+disabledID+`"]}`, getBlocksIndexes); nil != response["data"].(map[string]any)[disabledID] {
			t.Fatalf("indexes of disabled blocks should be hidden from the reader: %v", response["data"])
		}
		if response := blockGuardRequest(model.RoleReader, `{"ids":["`+disabledID+`"]}`, checkBlockRef); response["data"].(bool) {
			t.Fatalf("ref check of a disabled block should be hidden from the reader: %v", response["data"])
		}
	})

	t.Run("administrator", func(t *testing.T) {
		if response := blockGuardRequest(model.RoleAdministrator, `{"id":"`+disabledID+`"}`, checkBlockExist); !response["data"].(bool) {
			t.Fatalf("disabled block should be visible to the administrator, got %v", response["data"])
		}
	})
}

func postDocBlocksOrders(t *testing.T, body string) *docBlocksOrdersResponse {
	t.Helper()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	engine.POST("/api/block/getDocBlocksOrders", getDocBlocksOrders)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/block/getDocBlocksOrders", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &docBlocksOrdersResponse{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	return response
}
