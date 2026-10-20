package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVImagesGroupContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	attrView := av.NewAttributeView(fixture.attrView.ID)
	view := attrView.Views[0]
	blockKey := attrView.GetBlockKey()
	groupKey := attrView.KeyValues[1].Key
	images := &av.KeyValues{Key: av.NewKey(ast.NewNodeID(), "Images", "", av.KeyTypeMAsset)}
	hidden := &av.KeyValues{Key: av.NewKey(ast.NewNodeID(), "Hidden", "", av.KeyTypeMAsset)}
	attrView.KeyValues = append(attrView.KeyValues, images, hidden)
	var ids []string
	for i, name := range []string{"Alpha", "Beta", "Gamma", "Delta"} {
		id := ast.NewNodeID()
		ids = append(ids, id)
		attrView.GetBlockKeyValues().Values = append(attrView.GetBlockKeyValues().Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: id, Type: av.KeyTypeBlock,
			IsDetached: true, CreatedAt: int64(i + 1), Block: &av.ValueBlock{Content: name},
		})
		assets := []*av.ValueAsset{{Type: av.AssetTypeImage, Content: "assets/" + name + ".png"},
			{Type: av.AssetTypeFile, Content: "assets/document.pdf"}}
		if i == 0 {
			assets = append(assets, &av.ValueAsset{Type: av.AssetTypeImage, Content: "assets/Alpha-2.png"})
		}
		images.Values = append(images.Values, &av.Value{ID: ast.NewNodeID(), KeyID: images.Key.ID,
			BlockID: id, Type: av.KeyTypeMAsset, MAsset: assets})
		hidden.Values = append(hidden.Values, &av.Value{ID: ast.NewNodeID(), KeyID: hidden.Key.ID,
			BlockID: id, Type: av.KeyTypeMAsset,
			MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Content: "assets/hidden.png"}}})
	}
	view.ItemIDs = []string{ids[0], ids[3], ids[2], ids[1]}
	view.PageSize = 1
	view.Table.Columns = append(view.Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: images.Key.ID}},
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: hidden.Key.ID, Hidden: true}})
	view.Group = &av.ViewGroup{Field: groupKey.ID}
	first, second, empty := av.NewTableView(), av.NewTableView(), av.NewTableView()
	first.GroupItemIDs = []string{ids[1], ids[0], ids[2]}
	second.GroupItemIDs = []string{ids[3]}
	empty.GroupItemIDs = []string{}
	view.Groups = []*av.View{first, second, empty}
	const path = "/api/av/getCurrentAttrViewImages"
	for _, test := range []struct {
		name   string
		group  any
		query  string
		sort   bool
		filter bool
		want   []string
		code   int
	}{
		{name: "group manual order and all pages", group: first.ID,
			want: []string{"assets/Beta.png", "assets/Alpha.png", "assets/Alpha-2.png", "assets/Gamma.png"}},
		{name: "second group isolation", group: second.ID, want: []string{"assets/Delta.png"}},
		{name: "empty group", group: empty.ID},
		{name: "legacy omitted group", want: []string{"assets/Alpha.png", "assets/Alpha-2.png", "assets/Delta.png", "assets/Gamma.png", "assets/Beta.png"}},
		{name: "legacy null group", group: nil, want: []string{"assets/Alpha.png", "assets/Alpha-2.png", "assets/Delta.png", "assets/Gamma.png", "assets/Beta.png"}},
		{name: "legacy empty group", group: "", want: []string{"assets/Alpha.png", "assets/Alpha-2.png", "assets/Delta.png", "assets/Gamma.png", "assets/Beta.png"}},
		{name: "search within group", group: first.ID, query: "Alpha", want: []string{"assets/Alpha.png", "assets/Alpha-2.png"}},
		{name: "search cannot escape group", group: first.ID, query: "Delta"},
		{name: "saved sort", group: first.ID, sort: true,
			want: []string{"assets/Gamma.png", "assets/Beta.png", "assets/Alpha.png", "assets/Alpha-2.png"}},
		{name: "view filter", group: first.ID, filter: true,
			want: []string{"assets/Alpha.png", "assets/Alpha-2.png"}},
		{name: "unknown group fails closed", group: "missing", code: -1},
	} {
		t.Run(test.name, func(t *testing.T) {
			view.Sorts, view.Filters = nil, nil
			if test.sort {
				view.Sorts = []*av.ViewSort{{Column: blockKey.ID, Order: av.SortOrderDesc}}
			}
			if test.filter {
				view.Filters = []*av.ViewFilter{{Column: blockKey.ID, Operator: av.FilterOperatorIsEqual,
					Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Alpha"}}}}
			}
			if err := av.SaveAttributeView(attrView); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(util.DataDir, "storage", "av", attrView.ID+".json")
			before, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			payload := map[string]any{"id": attrView.ID, "viewID": view.ID, "query": test.query}
			if test.name != "legacy omitted group" {
				payload["groupID"] = test.group
			}
			response := callAttributeViewContextFilterAPI(t, path, payload, getCurrentAttrViewImages)
			requireAPIContract(t, http.MethodPost, path, response)
			var result struct {
				Code int
				Data []string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != test.code ||
				!reflect.DeepEqual(result.Data, test.want) {
				t.Fatalf("unexpected images: %s (%v), want %v", response.Body.String(), err, test.want)
			}
			after, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("image preview changed persisted database: %v", err)
			}
		})
	}
	for _, layout := range []av.LayoutType{av.LayoutTypeList, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			util.AttrViewLangs["en"][string(layout)] = string(layout)
			var layoutView, group *av.View
			switch layout {
			case av.LayoutTypeList:
				layoutView, group = av.NewListView(), av.NewListView()
				layoutView.List.Columns = view.Table.Columns
			case av.LayoutTypeGallery:
				layoutView, group = av.NewGalleryView(), av.NewGalleryView()
				for _, keyID := range []string{blockKey.ID, images.Key.ID} {
					layoutView.Gallery.CardFields = append(layoutView.Gallery.CardFields,
						&av.ViewGalleryCardField{BaseField: &av.BaseField{ID: keyID}})
				}
			case av.LayoutTypeKanban:
				layoutView, group = av.NewKanbanView(), av.NewKanbanView()
				for _, keyID := range []string{blockKey.ID, images.Key.ID} {
					layoutView.Kanban.Fields = append(layoutView.Kanban.Fields,
						&av.ViewKanbanField{BaseField: &av.BaseField{ID: keyID}})
				}
			}
			layoutView.Group, layoutView.ItemIDs, layoutView.PageSize = view.Group, view.ItemIDs, 1
			group.GroupItemIDs = first.GroupItemIDs
			layoutView.Groups = []*av.View{group}
			attrView.Views = append(attrView.Views, layoutView)
			if err := av.SaveAttributeView(attrView); err != nil {
				t.Fatal(err)
			}
			response := callAttributeViewContextFilterAPI(t, path, map[string]any{
				"id": attrView.ID, "viewID": layoutView.ID, "groupID": group.ID,
			}, getCurrentAttrViewImages)
			requireAPIContract(t, http.MethodPost, path, response)
			var result struct {
				Code int
				Data []string
			}
			want := []string{"assets/Beta.png", "assets/Alpha.png", "assets/Alpha-2.png", "assets/Gamma.png"}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 ||
				!reflect.DeepEqual(result.Data, want) {
				t.Fatalf("unexpected %s images: %s (%v)", layout, response.Body.String(), err)
			}
		})
	}
}
