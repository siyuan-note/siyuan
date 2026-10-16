package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVTemporarySortContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.AttrViewLangs["en"]["gallery"] = "Gallery"
	util.AttrViewLangs["en"]["kanban"] = "Kanban"
	util.AttrViewLangs["en"]["list"] = "List"
	attrView := av.NewAttributeView(fixture.attrView.ID)
	key := attrView.GetBlockKey()
	var ids []string
	for i, name := range []string{"Beta", "Alpha", "Gamma"} {
		id := ast.NewNodeID()
		ids = append(ids, id)
		attrView.KeyValues[0].Values = append(attrView.KeyValues[0].Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true,
			CreatedAt: int64(i + 1), Block: &av.ValueBlock{Content: name},
		})
	}
	grouped := av.NewTableView()
	grouped.Name = "Grouped"
	grouped.Group = &av.ViewGroup{Field: attrView.KeyValues[1].Key.ID}
	kanban := av.NewKanbanView()
	kanban.Group = &av.ViewGroup{Field: attrView.KeyValues[1].Key.ID}
	attrView.Views = append(attrView.Views, av.NewListView(), av.NewGalleryView(), kanban, grouped)
	for _, view := range attrView.Views {
		view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderDesc}}
		for _, values := range attrView.KeyValues {
			field := &av.BaseField{ID: values.Key.ID}
			switch view.LayoutType {
			case av.LayoutTypeTable, av.LayoutTypeList:
				layout := view.GetTableLayout()
				if view != attrView.Views[0] {
					layout.Columns = append(layout.Columns, &av.ViewTableColumn{BaseField: field})
				}
			case av.LayoutTypeGallery:
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: field})
			case av.LayoutTypeKanban:
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: field})
			}
		}
	}
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	// 先完成正常渲染的布局补全和分组初始化，再比较临时排序请求前后的文件。
	for _, view := range attrView.Views {
		if _, _, _, err := model.RenderAttributeViewWithTarget("", attrView.ID, view.ID, "", 1, 1, nil, "", false, false, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(util.DataDir, "storage", "av", attrView.ID+".json")
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	const path = "/api/av/renderAttributeView"
	for _, view := range attrView.Views {
		for _, test := range []struct {
			name string
			sort any
			page int
			want string
			code int
		}{
			{"saved", nil, 1, ids[2], 0},
			{"ascending", map[string]string{"column": key.ID, "order": "ASC"}, 1, ids[1], 0},
			{"second page", map[string]string{"column": key.ID, "order": "ASC"}, 2, ids[0], 0},
			{"descending", map[string]string{"column": key.ID, "order": "DESC"}, 1, ids[2], 0},
			{"deleted field", map[string]string{"column": "missing", "order": "ASC"}, 1, ids[2], 0},
			{"invalid order", map[string]string{"column": key.ID, "order": "invalid"}, 1, "", -1},
			{"empty order", map[string]string{"column": key.ID}, 1, "", -1},
			{"restored", nil, 1, ids[2], 0},
		} {
			t.Run(view.Name+"/"+test.name, func(t *testing.T) {
				response := callAttributeViewContextFilterAPI(t, path, map[string]any{
					"id": attrView.ID, "viewID": view.ID, "page": test.page, "pageSize": 1, "temporarySort": test.sort,
				}, renderAttributeView)
				requireAPIContract(t, http.MethodPost, path, response)
				var result struct {
					Code int
					Data struct {
						View struct {
							Rows   []struct{ ID string }
							Cards  []struct{ ID string }
							Groups []struct {
								Rows  []struct{ ID string }
								Cards []struct{ ID string }
							}
						}
					}
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != test.code {
					t.Fatalf("unexpected result: %s (%v)", response.Body.String(), err)
				}
				if test.code == 0 {
					rows := result.Data.View.Rows
					if view.LayoutType == av.LayoutTypeGallery || view.LayoutType == av.LayoutTypeKanban {
						rows = result.Data.View.Cards
					}
					if view.Group != nil {
						rows = nil
						for _, group := range result.Data.View.Groups {
							rows = append(rows, group.Rows...)
							rows = append(rows, group.Cards...)
						}
					}
					if len(rows) != 1 || rows[0].ID != test.want {
						t.Fatalf("sorting before pagination failed: %s", response.Body.String())
					}
				}
			})
		}
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("temporary sorting changed persisted database: %v", err)
	}
	stored, err := av.ParseAttributeView(attrView.ID)
	if err != nil || stored.Views[0].Sorts[0].Order != av.SortOrderDesc {
		t.Fatalf("temporary sorting contaminated cached data: %v", err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": attrView.ID, "createIfNotExist": true, "temporarySort": map[string]string{"column": key.ID, "order": "ASC"},
	}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("temporary sorting created a missing database: %v", err)
	}
}

func TestAVTemporarySortPublishContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	originalAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(originalAccess) })
	const path = "/api/av/renderAttributeView"
	payload := map[string]any{"id": fixture.attrView.ID, "blockID": fixture.databaseID, "ignoreRows": true,
		"temporarySort": map[string]string{"column": fixture.textKeyID, "order": "ASC"}}
	response := callAttributeViewContextFilterAPIWithRole(t, path, payload, renderAttributeView, model.RoleReader)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct{ Code int }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 {
		t.Fatalf("read-only sorting failed: %s (%v)", response.Body.String(), err)
	}
	block := treenode.GetBlockTree(fixture.databaseID)
	if err := model.SetPublishAccess(model.PublishAccess{{ID: block.RootID, Disable: true}}); err != nil {
		t.Fatal(err)
	}
	response = callAttributeViewContextFilterAPIWithRole(t, path, payload, renderAttributeView, model.RoleReader)
	requireAPIContract(t, http.MethodPost, path, response)
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code == 0 {
		t.Fatalf("temporary sorting bypassed publish access: %s (%v)", response.Body.String(), err)
	}
}
