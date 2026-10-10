package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAVContractMapMapping(t *testing.T) {
	table := &av.Table{Map: &av.MapSettings{LocationKeyID: "20261009000000-abcdefg", Height: 640},
		MapMarkerScope: "page", Columns: []*av.TableColumn{}, Rows: []*av.TableRow{}, RowCount: 120}
	assertAVContractJSONEqual(t, &av.Map{Table: table}, avContractView(&av.Map{Table: table}))
	layout := &av.LayoutMap{LayoutTable: av.NewLayoutTable(), Settings: *table.Map}
	assertAVContractJSONEqual(t, layout, toContractAVLayoutMap(layout))
	view := &av.View{ID: "view", LayoutType: av.LayoutTypeMap, Map: layout}
	assertAVContractJSONEqual(t, view, toContractAVView(view))
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	response := apicontract.Success(apicontract.NewAVRenderResult(apicontract.AVRenderData{
		AVArchiveRenderData: apicontract.AVArchiveRenderData{ViewType: "map", View: avContractView(&av.Map{Table: table})},
	}))
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse("POST", "/api/av/renderAttributeView", payload); err != nil {
		t.Fatal(err)
	}
}

func TestAVContractMapPublishRedactsPrivateTemplateDependencies(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	primary := database.GetBlockKeyValues()
	sourceID, publicID, privateID, privateDocID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	privateTree := treenode.NewTree(ast.NewNodeID(), "/"+privateDocID+".sy", "/Private", "Private")
	treenode.UpsertBlockTree(privateTree)
	av.UpsertBlockRel(database.ID, fixture.databaseID)
	const privateContent = "private-template-target"
	primary.Values = []*av.Value{
		{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: sourceID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Source"}},
		{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: publicID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Public"}},
		{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: privateID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: privateDocID, Content: privateContent}},
	}
	secretKey := av.NewKey(ast.NewNodeID(), "Secret", "", av.KeyTypeRelation)
	secretKey.Relation = &av.Relation{AvID: database.ID}
	publicKey := av.NewKey(ast.NewNodeID(), "Public", "", av.KeyTypeRelation)
	publicKey.Relation = &av.Relation{AvID: database.ID}
	labelKey := av.NewKey(ast.NewNodeID(), "Label", "", av.KeyTypeText)
	selectorKey := av.NewKey(ast.NewNodeID(), "Selector", "", av.KeyTypeText)
	displayKey := av.NewKey(ast.NewNodeID(), "Display", "", av.KeyTypeText)
	displayKey.RenderTemplate = fmt.Sprintf(`.action{getHPathByID %q}`, privateDocID)
	database.KeyValues = []*av.KeyValues{primary,
		{Key: secretKey, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: secretKey.ID, BlockID: sourceID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{privateID}}}}},
		{Key: publicKey, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: publicKey.ID, BlockID: sourceID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{publicID}}}}},
		{Key: labelKey, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: labelKey.ID, BlockID: sourceID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public label"}}}},
		{Key: selectorKey, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: selectorKey.ID, BlockID: sourceID, Type: av.KeyTypeText, Text: &av.ValueText{Content: secretKey.ID}}}},
		{Key: displayKey, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: displayKey.ID, BlockID: sourceID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public scalar"}}}},
	}
	templates := []struct {
		name, content, publicContent, privateMarker string
		key                                         *av.Key
	}{
		{name: "ByName", content: ".action{.Secret_raw.Relation.BlockIDs}", privateMarker: privateID},
		{name: "ByID", content: fmt.Sprintf(`.action{$value := index .id_mod_raw %q}.action{$value.Relation.BlockIDs}`, secretKey.ID), privateMarker: privateID},
		{name: "Indirect", content: ".action{.ByName}", privateMarker: privateID},
		{name: "Range", content: ".action{range .Secret_raw.Relation.BlockIDs}.action{.}.action{end}", privateMarker: privateID},
		{name: "Dynamic", content: ".action{index .id_mod .Selector}", privateMarker: privateContent},
		{name: "Chain", content: fmt.Sprintf(`.action{(index .id_mod_raw %q).Relation.BlockIDs}`, secretKey.ID), privateMarker: privateID},
		{name: "Constant", content: "constant result", publicContent: "constant result"},
		{name: "Local", content: ".action{.Label}", publicContent: "public label"},
		{name: "PublicRelation", content: ".action{.Public_raw.Relation.BlockIDs}", publicContent: "[" + publicID + "]"},
		{name: "StaticID", content: fmt.Sprintf(`.action{index .id_mod %q}`, labelKey.ID), publicContent: "public label"},
	}
	view.LayoutType = av.LayoutTypeMap
	view.Map = &av.LayoutMap{LayoutTable: view.Table}
	view.Table = nil
	view.Map.Columns = nil
	for _, keyValues := range database.KeyValues {
		view.Map.Columns = append(view.Map.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: keyValues.Key.ID}})
	}
	for i := range templates {
		test := &templates[i]
		test.key = av.NewKey(ast.NewNodeID(), test.name, "", av.KeyTypeTemplate)
		test.key.Template = test.content
		database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: test.key})
		view.Map.Columns = append(view.Map.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: test.key.ID}})
	}
	view.ItemIDs = []string{sourceID, publicID, privateID}
	view.Filters = []*av.ViewFilter{{Column: labelKey.ID, Operator: av.FilterOperatorIsEqual,
		Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "public label"}}}}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := av.GetAttributeViewDataPath(database.ID)
	before, _ := os.ReadFile(path)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/api/av/renderAttributeView", nil)
	filter := func(viewable av.Viewable) av.Viewable {
		return model.FilterAttributeViewByPublishAccess(context, model.PublishAccess{{ID: privateDocID, Disable: true}}, database.ID, "", viewable)
	}
	for _, published := range []bool{false, true} {
		responseFilter := func(viewable av.Viewable) av.Viewable { return viewable }
		if published {
			responseFilter = filter
		}
		response := renderAttrView("", database.ID, view.ID, "", 1, 50, nil, av.LayoutTypeMap, false, false, "", "", responseFilter, true)
		body, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Code int
			Data struct{ View *av.Table }
		}
		if err = json.Unmarshal(body, &result); err != nil || result.Code != 0 || result.Data.View == nil || len(result.Data.View.Rows) != 1 {
			t.Fatalf("map template render failed: %s (%v)", body, err)
		}
		row := result.Data.View.Rows[0]
		displayValue := row.GetValue(displayKey.ID)
		if displayValue == nil || displayValue.Text == nil || displayValue.Text.Content != "public scalar" ||
			(published && displayValue.RenderedContent != "") || (!published && displayValue.RenderedContent == "") {
			t.Fatal("map display-template redaction failed or changed the stored scalar")
		}
		for _, test := range templates {
			value := row.GetValue(test.key.ID)
			if value == nil || value.Template == nil {
				t.Fatalf("missing template %s", test.name)
			}
			if !published && test.privateMarker != "" {
				if !bytes.Contains([]byte(value.Template.Content), []byte(test.privateMarker)) {
					t.Fatalf("fixture template %s did not expose its private dependency: %q", test.name, value.Template.Content)
				}
			} else if value.Template.Content != test.publicContent {
				t.Fatalf("template %s published=%t content=%q, want %q", test.name, published, value.Template.Content, test.publicContent)
			}
		}
		if published && (len(row.GetValue(secretKey.ID).Relation.BlockIDs) != 0 || bytes.Contains(body, []byte(privateID)) || bytes.Contains(body, []byte(privateContent))) {
			t.Fatal("map response retained a private relation or derived template value")
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("map template redaction changed source storage")
	}
}

func TestAVContractMapPublishPagesAccessibleResult(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		count     int
		denyEvery int
	}{{"all 120 records accessible", 120, 0}, {"240 accessible records with 120 denied", 360, 3}} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := setupAttributeViewContextFilterAPITest(t)
			database, view := fixture.attrView, fixture.attrView.Views[0]
			primary := database.GetBlockKeyValues()
			privateID, boxID := ast.NewNodeID(), ast.NewNodeID()
			privateTree := treenode.NewTree(boxID, "/"+privateID+".sy", "/Private", "Private")
			treenode.UpsertBlockTree(privateTree)
			filterKey := av.NewKey(ast.NewNodeID(), "Keep", "", av.KeyTypeText)
			templateKey := av.NewKey(ast.NewNodeID(), "Rendered", "", av.KeyTypeTemplate)
			templateKey.Template = "Rendered record"
			filterValues := &av.KeyValues{Key: filterKey}
			database.KeyValues = append(database.KeyValues, filterValues, &av.KeyValues{Key: templateKey})
			primary.Values = nil
			view.ItemIDs = nil
			visibleIDs := []string{}
			hiddenID := ""
			for i := 0; i <= scenario.count; i++ {
				id := ast.NewNodeID()
				denied := scenario.denyEvery > 0 && i%scenario.denyEvery == 0
				value := &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
					Type: av.KeyTypeBlock, IsDetached: !denied, Block: &av.ValueBlock{Content: fmt.Sprintf("Record %03d", i)}}
				if denied {
					value.Block.ID = privateID
					if i < scenario.count {
						hiddenID = id
					}
				}
				filterText := "keep"
				if i == scenario.count {
					filterText = "skip"
				} else if !denied {
					visibleIDs = append(visibleIDs, id)
				}
				primary.Values = append(primary.Values, value)
				filterValues.Values = append(filterValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: filterKey.ID, BlockID: id,
					Type: av.KeyTypeText, Text: &av.ValueText{Content: filterText}})
				view.ItemIDs = append(view.ItemIDs, id)
			}
			view.PageSize = 50
			view.Filters = []*av.ViewFilter{{Column: filterKey.ID, Operator: av.FilterOperatorIsEqual,
				Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "keep"}}}}
			view.LayoutType = av.LayoutTypeMap
			view.Map = &av.LayoutMap{LayoutTable: view.Table}
			view.Table = nil
			view.Map.Columns = []*av.ViewTableColumn{
				{BaseField: &av.BaseField{ID: primary.Key.ID}, Calc: &av.FieldCalc{Operator: av.CalcOperatorCountAll}},
				{BaseField: &av.BaseField{ID: filterKey.ID}},
				{BaseField: &av.BaseField{ID: templateKey.ID}},
			}
			view.GroupCalc = &av.GroupCalc{Field: primary.Key.ID, FieldCalc: &av.FieldCalc{Operator: av.CalcOperatorCountAll}}
			if err := av.SaveAttributeView(database); err != nil {
				t.Fatal(err)
			}
			path := av.GetAttributeViewDataPath(database.ID)
			before, _ := os.ReadFile(path)
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodPost, "/api/av/renderAttributeView", nil)
			filter := func(viewable av.Viewable) av.Viewable {
				return model.FilterAttributeViewByPublishAccess(context, model.PublishAccess{{ID: privateID, Disable: true}}, database.ID, "", viewable)
			}
			render := func(page int, targetID string) (*av.Table, *model.AttributeViewRenderTarget) {
				t.Helper()
				response := renderAttrView("", database.ID, view.ID, "", page, 50, nil, av.LayoutTypeMap, false, false,
					targetID, "", filter, true)
				body, err := json.Marshal(response)
				if err != nil {
					t.Fatal(err)
				}
				var result struct {
					Code int
					Data struct {
						View   *av.Table
						Target *model.AttributeViewRenderTarget
					}
				}
				if err = json.Unmarshal(body, &result); err != nil || result.Code != 0 || result.Data.View == nil {
					t.Fatalf("map render failed: %s, %v", body, err)
				}
				mapped := result.Data.View
				if mapped.RowCount != len(visibleIDs) || mapped.GroupCalc != nil || mapped.Columns[0].Calc != nil {
					t.Fatalf("public count or aggregates include denied rows: %s", body)
				}
				for _, row := range mapped.Rows {
					value := row.GetValue(templateKey.ID)
					if value == nil || value.Template == nil || value.Template.Content != "Rendered record" {
						t.Fatal("re-paginated row lost its deferred template value")
					}
				}
				if bytes.Contains(body, []byte("RowsBeforePagination")) {
					t.Fatal("private full row buffer was serialized")
				}
				return mapped, result.Data.Target
			}
			var returnedIDs []string
			for page := 1; page <= (len(visibleIDs)+49)/50+1; page++ {
				mapped, _ := render(page, "")
				start := min(len(visibleIDs), (page-1)*50)
				end := min(len(visibleIDs), start+50)
				if len(mapped.Rows) != end-start {
					t.Fatalf("page %d returned %d rows, want %d", page, len(mapped.Rows), end-start)
				}
				for _, row := range mapped.Rows {
					returnedIDs = append(returnedIDs, row.ID)
				}
			}
			if !reflect.DeepEqual(returnedIDs, visibleIDs) {
				t.Fatal("public pagination skipped or repeated accessible records")
			}
			mapped, target := render(1, visibleIDs[len(visibleIDs)-1])
			if target == nil || target.Status != "visible" || target.Index != len(visibleIDs)-1 ||
				target.Offset != max(0, len(visibleIDs)-av.ViewDefaultPageSize*4) || len(mapped.Rows) > av.ViewDefaultPageSize*4 {
				t.Fatal("public target window used unauthorized row positions or exceeded the ordinary bound")
			}
			if hiddenID != "" {
				mapped, target = render(1, hiddenID)
				if target == nil || target.Status != "itemNotFound" || target.Index != 0 || target.Offset != 0 || len(mapped.Rows) != 50 {
					t.Fatal("denied target exposed its original position or bypassed paging")
				}
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("public map re-pagination changed source storage")
			}
		})
	}
}

func TestAVContractMapPublishFiltersTargetsAndPreservesSource(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	view := database.Views[0]
	primary := database.GetBlockKeyValues()
	visibleID, hiddenID := ast.NewNodeID(), ast.NewNodeID()
	primary.Values = nil
	for _, id := range []string{hiddenID, visibleID} {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
	}
	view.ItemIDs = []string{hiddenID, visibleID}
	view.LayoutType = av.LayoutTypeMap
	view.Map = &av.LayoutMap{LayoutTable: view.Table, Settings: av.MapSettings{LocationKeyID: ast.NewNodeID(), Height: 800}}
	view.Table = nil
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := av.GetAttributeViewDataPath(database.ID)
	before, _ := os.ReadFile(path)
	filter := func(viewable av.Viewable) av.Viewable {
		mapped := viewable.(*av.Map)
		rows := []*av.TableRow{}
		for _, row := range mapped.Rows {
			if row.ID != hiddenID {
				rows = append(rows, row)
			}
		}
		mapped.Rows = rows
		return mapped
	}
	for _, targetID := range []string{hiddenID, visibleID} {
		response := renderAttrView("", database.ID, view.ID, "", 1, 1, nil, av.LayoutTypeMap, false, false,
			targetID, "", filter, true)
		body, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Code int
			Data struct {
				View   *av.Table
				Target *model.AttributeViewRenderTarget
			}
		}
		if err = json.Unmarshal(body, &result); err != nil {
			t.Fatal(err)
		}
		want := "visible"
		if targetID == hiddenID {
			want = "itemNotFound"
		}
		if result.Code != 0 || result.Data.View.RowCount != 1 || len(result.Data.View.Rows) != 1 ||
			result.Data.Target.Status != want || result.Data.Target.Index != 0 || result.Data.Target.Offset != 0 {
			t.Fatalf("publish leaked map count or target: %s", body)
		}
		if result.Data.View.Map == nil || result.Data.View.Map.Height != 800 {
			t.Fatalf("publish lost map height: %s", body)
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("read-only map render changed its source")
	}
}
