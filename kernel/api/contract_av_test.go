package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVContractRemoveReferencedDatabase(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	block := treenode.GetBlockTree(fixture.databaseID)
	if block == nil {
		t.Fatal("database carrier is missing")
	}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&model.Box{ID: block.BoxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "storage", "av", fixture.attrView.ID+".json")
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/av/removeUnusedAttributeView"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": fixture.attrView.ID}, removeUnusedAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || result.Code != -1 || string(result.Data) != "null" {
		t.Fatalf("referenced database cleanup response: %s", response.Body.String())
	}
	remaining, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(original, remaining) {
		t.Fatalf("referenced database changed: %v", err)
	}
}

func assertAVContractJSONEqual(t *testing.T, want, got any) {
	t.Helper()
	left, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	right, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var l, r any
	if err = json.Unmarshal(left, &l); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(right, &r); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(l, r) {
		t.Fatalf("wire payload differs\nwant %s\ngot  %s", left, right)
	}
}

func TestAVContractTransportMapping(t *testing.T) {
	base := &av.BaseInstance{ID: "view", Filters: []*av.ViewFilter{}, Sorts: nil, PageSize: 50, Group: &av.ViewGroup{Field: "key"}}
	value := &av.Value{ID: "value", Type: av.KeyTypeText, Text: &av.ValueText{Content: "content"}, Relation: &av.ValueRelation{BlockIDs: []string{}}}
	for _, view := range []av.Viewable{
		&av.Table{BaseInstance: base, Columns: []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{ID: "key", Type: av.KeyTypeText}}}, Rows: []*av.TableRow{{ID: "item", Cells: []*av.TableCell{{BaseValue: &av.BaseValue{ID: "cell", Value: value, ValueType: av.KeyTypeText}}}}}},
		&av.Gallery{BaseInstance: base},
		&av.Kanban{BaseInstance: base},
		&av.Table{},
		&av.List{Table: &av.Table{BaseInstance: base, Columns: []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{ID: "key", Type: av.KeyTypeText, Hidden: true}}}}},
	} {
		assertAVContractJSONEqual(t, view, avContractView(view))
	}
	assertAVContractJSONEqual(t, value, toContractAVValue(value))
	assertAVContractJSONEqual(t, &av.ViewTableColumn{BaseField: &av.BaseField{ID: "key", Calc: &av.FieldCalc{}}, Calc: nil}, toContractAVViewTableColumn(&av.ViewTableColumn{BaseField: &av.BaseField{ID: "key", Calc: &av.FieldCalc{}}, Calc: nil}))
	fixture := setupAttributeViewContextFilterAPITest(t)
	assertAVContractJSONEqual(t, model.NewAttributeViewData(fixture.attrView), toContractAVAttributeViewData(model.NewAttributeViewData(fixture.attrView)))
}

func TestAVContractListLayout(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.AttrViewLangs["en"]["list"] = "List"
	path := "/api/av/changeAttrViewLayout"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "layoutType": "list",
	}, changeAttrViewLayout)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int `json:"code"`
		Data struct {
			ViewType string    `json:"viewType"`
			View     *av.Table `json:"view"`
		} `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.ViewType != "list" || result.Data.View == nil {
		t.Fatalf("list layout response: %s", response.Body.String())
	}
	if len(result.Data.View.Columns) != len(fixture.attrView.KeyValues) {
		t.Fatalf("list fields missing: %s", response.Body.String())
	}
	for _, field := range result.Data.View.Columns {
		if field.Hidden != (field.Type != av.KeyTypeBlock) {
			t.Fatalf("unexpected list field visibility: %+v", field)
		}
	}
	path = "/api/av/renderAttributeView"
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "ignoreRows": true,
	}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.ViewType != "list" {
		t.Fatalf("list render response: %s", response.Body.String())
	}
	stored, err := av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, model.NewAttributeViewData(stored), toContractAVAttributeViewData(model.NewAttributeViewData(stored)))
}

func TestAVContractRenderWire(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/av/renderAttributeView"
	view, attrView, target, err := model.RenderAttributeViewWithTarget(fixture.databaseID, fixture.attrView.ID, fixture.attrView.Views[0].ID, "", 1, -1, map[string]any{}, "", false, true, "", "")
	if err != nil {
		t.Fatal(err)
	}
	var views []*av.ViewData
	for _, v := range attrView.Views {
		views = append(views, &av.ViewData{ID: v.ID, Icon: v.Icon, Name: v.Name, Desc: v.Desc, HideAttrViewName: v.HideAttrViewName, Type: v.LayoutType, PageSize: v.PageSize})
	}
	contextFilter, err := model.GetAttributeViewContextFilter(attrView, fixture.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	data := map[string]any{"name": attrView.Name, "id": attrView.ID, "customColors": attrView.Palette(), "colorOrder": attrView.PaletteOrder(), "usedCustomColorIndexes": attrView.UsedCustomColorIndexes(), "viewType": view.GetType(), "viewID": view.GetID(), "views": views, "view": view, "isMirror": av.IsMirror(attrView.ID), "newItemTemplates": attrView.NewItemTemplates, "defaultTemplateID": attrView.DefaultTemplateID, "contextFilter": contextFilter, "contextFilterFields": attrView.ContextFilterFields()}
	if target != nil {
		data["target"] = target
	}
	want := gulu.Ret.NewResult()
	want.Data = data
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": fixture.attrView.ID, "blockID": fixture.databaseID, "viewID": fixture.attrView.Views[0].ID, "createIfNotExist": false, "ignoreRows": true}, renderAttributeView)
	if err = bundle.ValidateHTTPResponse(http.MethodPost, path, response.Code, response.Header().Get("Content-Type"), response.Body.Bytes()); err != nil {
		t.Fatalf("render schema: %v\n%s", err, response.Body.String())
	}
	var got json.RawMessage = response.Body.Bytes()
	assertAVContractJSONEqual(t, want, got)
	missing := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": fixture.attrView.ID, "blockID": fixture.databaseID, "viewID": "20260913000000-missing", "createIfNotExist": false, "ignoreRows": true}, renderAttributeView)
	if err = bundle.ValidateResponse(http.MethodPost, path, missing.Body.Bytes()); err != nil {
		t.Fatalf("missing view schema: %v\n%s", err, missing.Body.String())
	}
}

func TestAVContractRowSortMapping(t *testing.T) {
	group := "group"
	change := &model.AttributeViewRowOrderChange{RowOrder: &model.AttributeViewRowOrder{ItemIDs: []string{"a", "b"}, Groups: map[string][]string{"group": {"b"}}, Sorts: []*av.ViewSort{}}, Expected: &model.AttributeViewRowOrder{ItemIDs: []string{"b", "a"}}, ValidateGroup: &group}
	operations := []*model.Operation{{Action: "sortAttrViewRow", AvID: "av", BlockID: "block", ViewID: "view", Data: change}}
	converted, err := avRowSortOperations(operations)
	if err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, operations, converted)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(apicontract.Success(apicontract.AVRowSortPreview{DoOperations: converted, UndoOperations: []*apicontract.AVRowSortOperation{}}))
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse("POST", "/api/av/getAttributeViewRowSort", payload); err != nil {
		t.Fatalf("row sort schema: %v\n%s", err, payload)
	}
}

func TestAVContractPublishAccessBeforeKeyIDs(t *testing.T) {
	setupAttributeViewContextFilterAPITest(t)
	response := callAttributeViewContextFilterAPIWithRole(t, "/api/av/getAttributeViewKeysByID", map[string]any{"avID": "20260913000000-missing", "keyIDs": []any{nil}}, getAttributeViewKeysByID, model.RoleReader)
	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Code != -1 || result.Msg != av.ErrAttributeViewNotFound.Error() {
		t.Fatalf("publish admission order changed: %s", response.Body.String())
	}
}
