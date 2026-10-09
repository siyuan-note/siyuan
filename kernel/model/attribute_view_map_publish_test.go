package model

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewMapPublishExcludesDeniedBoundRows(t *testing.T) {
	const boxID, documentID = "20261009000000-box0001", "20261009000001-doc0001"
	oldDataDir, oldBlockTreePath := util.DataDir, util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldDataDir, oldBlockTreePath
		invalidateEncryptedPublishAccessCache()
		if oldBlockTreePath != "" {
			treenode.InitBlockTree(false)
		}
	})
	tree := treenode.NewTree(boxID, "/"+documentID+".sy", "/Private", "Private")
	treenode.UpsertBlockTree(tree)
	row := func(id string, detached bool) *av.TableRow {
		return &av.TableRow{ID: id, Cells: []*av.TableCell{{BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeBlock, Value: &av.Value{Type: av.KeyTypeBlock, IsDetached: detached,
				Block: &av.ValueBlock{ID: documentID, Content: id}},
		}}}}
	}
	mapped := &av.Map{Table: &av.Table{BaseInstance: &av.BaseInstance{},
		Rows: []*av.TableRow{row("private", false), row("public", true)}, RowCount: 120}}
	originalCalc := &av.FieldCalc{Operator: av.CalcOperatorCountAll, Result: &av.Value{Number: &av.ValueNumber{Content: 120, IsNotEmpty: true}}}
	mapped.Columns = []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{Calc: originalCalc}}}
	mapped.GroupCalc = &av.GroupCalc{FieldCalc: originalCalc}
	mapped.Rows[1].ConditionalColors = &av.ItemConditionalColors{Background: &av.ValueSelect{Color: "1"}}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterViewByPublishAccess(context, PublishAccess{{ID: documentID, Disable: true}}, mapped).(*av.Map)
	if filtered.RowCount != 1 || len(filtered.Rows) != 1 || filtered.Rows[0].ID != "public" {
		t.Fatal("map publish returned a denied row or its original count")
	}
	if filtered.Columns[0].Calc != nil || filtered.GroupCalc != nil || filtered.Rows[0].ConditionalColors != nil || originalCalc.Result.Number.Content != 120 {
		t.Fatal("public map retained pre-filter derived data or changed the source calculation")
	}
}

func TestAttributeViewMapPublishTemplateSyntax(t *testing.T) {
	for _, test := range []struct {
		content string
		want    bool
	}{
		{"constant result", true},
		{".action{.Label}", true},
		{".action{index .Secret_raw.Relation.BlockIDs 0}", true},
		{`.action{index .id_mod "key"}`, true},
		{`.action{index .id_mod_raw "key"}`, true},
		{`.action{index . "Label"}`, false},
		{`.action{index . "id_mod_raw"}`, false},
		{`.action{printf "%s" .Label}`, true},
		{".action{range .Secret_raw.Relation.BlockIDs}.action{.}.action{end}", false},
		{".action{if .Secret}.action{.Secret}.action{end}", false},
		{".action{with .Secret_raw}.action{.Relation}.action{end}", false},
		{`.action{(index .id_mod_raw "key").Relation.BlockIDs}`, false},
		{`.action{index .id_mod_raw.secret.Relation.Contents "other"}`, false},
		{`.action{index .id_mod.secret "other"}`, false},
		{".action{index .id_mod .Selector}", false},
		{".action{.}", false},
		{".action{$.Secret}", false},
		{".action{.id_mod_raw}", false},
		{`.action{sql "SELECT content FROM blocks"}`, false},
		{`.action{getHPathByID "private-block"}`, false},
	} {
		if got := mapTemplateDependencySyntaxIsSupported(test.content); got != test.want {
			t.Errorf("template %q supported=%t, want %t", test.content, got, test.want)
		}
	}
}

func TestAttributeViewMapPublishSuppressesTemplateErrors(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeMap, av.LayoutTypeTable, av.LayoutTypeList,
		av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		for _, writable := range []bool{false, true} {
			want := layout != av.LayoutTypeMap || writable
			if got := shouldPushAttributeViewTemplateErrors(layout, writable); got != want {
				t.Errorf("layout=%s writable=%t push=%t, want %t", layout, writable, got, want)
			}
		}
	}
}

func TestAttributeViewMapPublishTemplateRedactionClonesOnlyMapResponse(t *testing.T) {
	key := &av.Key{ID: "template", Type: av.KeyTypeTemplate, Template: ".action{.}"}
	source := &av.Value{KeyID: key.ID, BlockID: "item", Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: "private derived value"}}
	database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: key, Values: []*av.Value{source}}}}
	filter := &attributeViewPublishAccessFilter{}
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeCalendar, av.LayoutTypeMap} {
		table := &av.Table{BaseInstance: &av.BaseInstance{}, Rows: []*av.TableRow{{ID: "item", Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: source}}}}}}
		var viewable av.Viewable = table
		if layout == av.LayoutTypeCalendar {
			viewable = &av.Calendar{Table: table}
		} else if layout == av.LayoutTypeMap {
			viewable = &av.Map{Table: table}
		}
		filter.filterViewable(database, viewable)
		got := table.Rows[0].Cells[0].Value
		if layout == av.LayoutTypeMap {
			if got == source || got.Template.Content != "" {
				t.Fatal("map redaction did not use a cleared response-only clone")
			}
		} else if got != source || got.Template.Content != "private derived value" {
			t.Fatal("map-only redaction changed a pre-existing layout")
		}
	}
	if source.Template.Content != "private derived value" {
		t.Fatal("map template redaction mutated source value")
	}
}

func TestAttributeViewMapPublishDisplayTemplatePreservesStoredValues(t *testing.T) {
	latitude, longitude := 0.0, 120.0
	for _, typ := range []av.KeyType{av.KeyTypeText, av.KeyTypeLocation, av.KeyTypeTemplate} {
		key := &av.Key{ID: "display", Type: typ, Template: "public computed", RenderTemplate: `.action{getHPathByID "private-block"}`}
		source := &av.Value{KeyID: key.ID, BlockID: "item", Type: typ, RenderedContent: "private path", HasRenderTemplate: true}
		if typ == av.KeyTypeText {
			source.Text = &av.ValueText{Content: "public scalar"}
		} else if typ == av.KeyTypeLocation {
			source.Location = &av.ValueLocation{Name: "public location", Latitude: &latitude, Longitude: &longitude}
		} else {
			source.Template = &av.ValueTemplate{Content: "public computed"}
		}
		database := &av.AttributeView{ID: "database", KeyValues: []*av.KeyValues{{Key: key, Values: []*av.Value{source}}}}
		filter := &attributeViewPublishAccessFilter{}
		for _, mapped := range []bool{false, true} {
			table := &av.Table{BaseInstance: &av.BaseInstance{}, Rows: []*av.TableRow{{ID: "item", Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: source}}}}}}
			var viewable av.Viewable = table
			if mapped {
				viewable = &av.Map{Table: table}
			}
			filter.filterViewable(database, viewable)
			got := table.Rows[0].Cells[0].Value
			if mapped {
				if got == source || got.RenderedContent != "" || !got.HasRenderTemplate {
					t.Fatal("display template did not use a cleared response clone")
				}
				if typ == av.KeyTypeText && got.Text.Content != "public scalar" || typ == av.KeyTypeLocation &&
					(got.Location.Name != "public location" || *got.Location.Latitude != latitude || *got.Location.Longitude != longitude) ||
					typ == av.KeyTypeTemplate && got.Template.Content != "public computed" {
					t.Fatal("display-template redaction changed the stored scalar or coordinates")
				}
			} else if got != source || got.RenderedContent != "private path" {
				t.Fatal("map display-template policy changed the ordinary table")
			}
		}
		if source.RenderedContent != "private path" {
			t.Fatal("display-template redaction mutated the original value")
		}
		key.RenderTemplate = "public constant"
		value := &av.BaseValue{Value: source}
		filter.filterMapTemplateValue(database, "item", value)
		if value.Value != source {
			t.Fatal("a provably public display template was unnecessarily cloned or cleared")
		}
	}
}
