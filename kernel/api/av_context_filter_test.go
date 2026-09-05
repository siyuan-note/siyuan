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
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type attributeViewContextFilterAPIFixture struct {
	attrView      *av.AttributeView
	databaseID    string
	paragraphID   string
	relationKeyID string
	textKeyID     string
}

func TestSetAttrViewContextFilterHandler(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)

	success := callAttributeViewContextFilterAPI(t, "/api/av/setAttrViewContextFilter", map[string]any{
		"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "keyID": fixture.relationKeyID,
	}, setAttrViewContextFilter)
	var successResponse struct {
		Code int `json:"code"`
		Data struct {
			ContextFilter *av.AttributeViewContextFilter `json:"contextFilter"`
		} `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, success, &successResponse)
	if 0 != successResponse.Code || nil == successResponse.Data.ContextFilter ||
		fixture.relationKeyID != successResponse.Data.ContextFilter.KeyID {
		t.Fatalf("unexpected successful setter response: %s", success.Body.String())
	}

	for _, test := range []struct {
		name    string
		blockID string
		keyID   string
	}{
		{name: "non relation key", blockID: fixture.databaseID, keyID: fixture.textKeyID},
		{name: "non database carrier", blockID: fixture.paragraphID, keyID: fixture.relationKeyID},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := callAttributeViewContextFilterAPI(t, "/api/av/setAttrViewContextFilter", map[string]any{
				"avID": fixture.attrView.ID, "blockID": test.blockID, "keyID": test.keyID,
			}, setAttrViewContextFilter)
			var result struct {
				Code int `json:"code"`
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			if -1 != result.Code {
				t.Fatalf("invalid setter request was accepted: %s", response.Body.String())
			}
		})
	}
}

func TestRenderAttributeViewReturnsContextFilterMetadata(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	payload := map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "viewID": fixture.attrView.Views[0].ID,
		"page": 1, "pageSize": -1, "createIfNotExist": false, "ignoreRows": true,
	}
	response := callAttributeViewContextFilterAPI(t, "/api/av/renderAttributeView", payload, renderAttributeView)
	var result struct {
		Code int `json:"code"`
		Data struct {
			ContextFilter       *av.AttributeViewContextFilter        `json:"contextFilter"`
			ContextFilterFields []*av.AttributeViewContextFilterField `json:"contextFilterFields"`
		} `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if 0 != result.Code || nil == result.Data.ContextFilter ||
		fixture.relationKeyID != result.Data.ContextFilter.KeyID {
		t.Fatalf("render response omitted the instance context filter: %s", response.Body.String())
	}
	if 1 != len(result.Data.ContextFilterFields) {
		t.Fatalf("unexpected render context filter fields: %s", response.Body.String())
	}
	field := result.Data.ContextFilterFields[0]
	if fixture.relationKeyID != field.ID || "Project" != field.Name || "1f4c1" != field.Icon ||
		fixture.attrView.ID != field.TargetAvID {
		t.Fatalf("unexpected render context filter field: %#v", field)
	}

	readOnlyResponse := callAttributeViewContextFilterAPIWithRole(t, "/api/av/renderAttributeView", payload,
		renderAttributeView, model.RoleReader)
	var readOnlyResult struct {
		Code int `json:"code"`
		Data struct {
			ContextFilter       *av.AttributeViewContextFilter        `json:"contextFilter"`
			ContextFilterFields []*av.AttributeViewContextFilterField `json:"contextFilterFields"`
		} `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, readOnlyResponse, &readOnlyResult)
	if 0 != readOnlyResult.Code || nil != readOnlyResult.Data.ContextFilter ||
		0 != len(readOnlyResult.Data.ContextFilterFields) {
		t.Fatalf("read-only render leaked context filter metadata: %s", readOnlyResponse.Body.String())
	}
}

func setupAttributeViewContextFilterAPITest(t *testing.T) *attributeViewContextFilterAPIFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	oldDataDir, oldBlockTreeDBPath := util.DataDir, util.BlockTreeDBPath
	oldLang, oldLangs, oldAttrViewLangs := util.Lang, util.Langs, util.AttrViewLangs
	oldConf := model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	util.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {105: "Database", 314: "Database is unavailable"}}
	util.AttrViewLangs = map[string]map[string]any{
		"en": {"key": "Key", "select": "Select", "table": "Table"},
	}
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.Sync = conf.NewSync()
	cache.ClearAVCache()
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		cache.ClearAVCache()
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreeDBPath
		util.Lang, util.Langs, util.AttrViewLangs = oldLang, oldLangs, oldAttrViewLangs
		model.Conf = oldConf
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	const (
		boxID           = "20260904002000-ctxbox0"
		documentID      = "20260904002001-ctxdoc0"
		databaseID      = "20260904002002-ctxav00"
		paragraphID     = "20260904002003-ctxpara"
		attributeViewID = "20260904002004-ctxdata"
		relationKeyID   = "20260904002005-ctxrel0"
		textKeyID       = "20260904002006-ctxtext"
	)
	attrView := av.NewAttributeView(attributeViewID)
	attrView.KeyValues = append(attrView.KeyValues,
		&av.KeyValues{Key: &av.Key{
			ID: relationKeyID, Name: "Project", Icon: "1f4c1", Type: av.KeyTypeRelation,
			Relation: &av.Relation{AvID: attributeViewID},
		}},
		&av.KeyValues{Key: &av.Key{ID: textKeyID, Name: "Text", Type: av.KeyTypeText}},
	)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	t.Cleanup(func() { av.SetAVBoxID(attributeViewID, "") })

	contextFilter := &av.AttributeViewContextFilter{
		Spec: av.AttributeViewContextFilterSpec, KeyID: relationKeyID,
	}
	raw, err := contextFilter.Marshal()
	if nil != err {
		t.Fatal(err)
	}
	tree := treenode.NewTree(boxID, "/"+documentID+".sy", "/Context filter", "Context filter")
	for nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	database := &ast.Node{
		Type: ast.NodeAttributeView, ID: databaseID, AttributeViewID: attributeViewID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	database.SetIALAttr("id", databaseID)
	database.SetIALAttr(av.NodeAttrView, attrView.Views[0].ID)
	database.SetIALAttr(av.NodeAttrContextFilter, raw)
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: paragraphID}
	paragraph.SetIALAttr("id", paragraphID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("not a database")})
	tree.Root.AppendChild(database)
	tree.Root.AppendChild(paragraph)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)

	return &attributeViewContextFilterAPIFixture{
		attrView: attrView, databaseID: databaseID, paragraphID: paragraphID,
		relationKeyID: relationKeyID, textKeyID: textKeyID,
	}
}

func callAttributeViewContextFilterAPI(t *testing.T, path string, payload map[string]any,
	handler gin.HandlerFunc) *httptest.ResponseRecorder {
	return callAttributeViewContextFilterAPIWithRole(t, path, payload, handler, model.RoleAdministrator)
}

func callAttributeViewContextFilterAPIWithRole(t *testing.T, path string, payload map[string]any,
	handler gin.HandlerFunc, role model.Role) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if nil != err {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Set(model.RoleContextKey, role)
	handler(context)
	return recorder
}

func decodeAttributeViewContextFilterAPIResponse(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.Unmarshal(recorder.Body.Bytes(), target); nil != err {
		t.Fatalf("decode API response failed: %v\n%s", err, recorder.Body.String())
	}
}
