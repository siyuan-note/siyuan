package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVContractDetachedItemIcon(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_AV_ICON_CONTRACT") != "1" {
		// 数据库索引和队列有进程级状态，使用独立进程验证实际写入路径。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAVContractDetachedItemIcon$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_AV_ICON_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("icon contract subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.TempDir, util.ConfDir, util.HistoryDir = t.TempDir(), t.TempDir(), t.TempDir()
	languageData, err := os.ReadFile("../../app/appearance/langs/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs["en"] = language.Time
	model.Conf.Search, model.Conf.Editor, model.Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	tree, err := model.LoadTreeByBlockID(fixture.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	util.QueueDir = t.TempDir()
	util.DBPath = filepath.Join(t.TempDir(), util.DBName)
	util.HistoryDBPath = filepath.Join(t.TempDir(), "history.db")
	util.AssetContentDBPath = filepath.Join(t.TempDir(), "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.UpsertBlockTree(tree)
	defer func() {
		time.Sleep(700 * time.Millisecond)
		sql.FlushQueue()
		sql.CloseDatabase()
	}()
	database := fixture.attrView
	primary := database.GetBlockKeyValues()
	itemID := ast.NewNodeID()
	primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID,
		BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Entry", Icon: "1f600"}})
	database.Views[0].ItemIDs = append(database.Views[0].ItemIDs, itemID)
	database.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Detached",
		TargetType: av.NewItemTargetDetached, Icon: "1f600"}}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := "/api/av/setAttributeViewBlockAttr"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"avID": database.ID, "keyID": primary.Key.ID, "itemID": itemID,
		"value": map[string]any{"block": map[string]any{"icon": "1f680"}},
	}, setAttributeViewBlockAttr)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int
		Data struct{ Value *av.Value }
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.Value.Block.Icon != "1f680" || result.Data.Value.Block.Content != "Entry" {
		t.Fatalf("partial icon update lost primary text: %s", response.Body.String())
	}
	tree, err = model.LoadTreeByBlockID(fixture.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 2}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
	tree.Root.AppendChild(heading)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	path = "/api/av/batchReplaceAttributeViewBlocks"
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{
		"avID": database.ID, "isDetached": false, "oldNew": []map[string]string{{itemID: heading.ID}},
	}, batchReplaceAttributeViewBlocks)
	requireAPIContract(t, http.MethodPost, path, response)
	var boundResult struct{ Code int }
	decodeAttributeViewContextFilterAPIResponse(t, response, &boundResult)
	stored, err := av.ParseAttributeView(database.ID)
	if err != nil || boundResult.Code != 0 || stored.GetBlockValue(itemID).Block.Icon != "1f680" {
		t.Fatalf("binding lost inherited icon: %s, %v", response.Body.String(), err)
	}
}

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
	for _, visibility := range []string{"", "always", "hide-empty", "hide"} {
		key := &av.Key{ID: "key", Type: av.KeyTypeText, AttributePanelVisibility: visibility}
		assertAVContractJSONEqual(t, key, toContractAVKey(key))
	}
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
	for _, content := range []string{"", "<b>display</b>"} {
		value.Relation.Contents = []*av.Value{{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "original"},
			HasRenderTemplate: true, RenderedContent: content}}
		assertAVContractJSONEqual(t, value, toContractAVValue(value))
	}
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
