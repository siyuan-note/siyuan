package model

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetCurrentAttributeViewImagesDynamicGroups(t *testing.T) {
	for _, mode := range []string{"template", "date"} {
		t.Run(mode, func(t *testing.T) {
			setupAttributeViewValidationTest(t)
			attrView := av.NewAttributeView(ast.NewNodeID())
			view := attrView.Views[0]
			key := attrView.KeyValues[1].Key
			key.Type = av.KeyTypeDate
			view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodDateDay}
			if mode == "template" {
				key.RenderTemplate = "A"
				view.Group.Method = av.GroupMethodValue
				view.Group.ValueSource = av.ValueSourceRendered
			}
			images := &av.KeyValues{Key: av.NewKey(ast.NewNodeID(), "Images", "", av.KeyTypeMAsset)}
			attrView.KeyValues = append(attrView.KeyValues, images)
			view.Table.Columns = append(view.Table.Columns,
				&av.ViewTableColumn{BaseField: &av.BaseField{ID: images.Key.ID}})
			day := time.Date(2026, time.October, 19, 12, 0, 0, 0, time.Local)
			names := []string{"first", "second"}
			if mode == "date" {
				names = append(names, "outside")
			}
			for i, name := range names {
				id := ast.NewNodeID()
				view.ItemIDs = append(view.ItemIDs, id)
				attrView.GetBlockKeyValues().Values = append(attrView.GetBlockKeyValues().Values, &av.Value{
					ID: ast.NewNodeID(), KeyID: attrView.GetBlockKey().ID, BlockID: id,
					Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: name},
				})
				attrView.KeyValues[1].Values = append(attrView.KeyValues[1].Values, &av.Value{
					ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: av.KeyTypeDate,
					Date: &av.ValueDate{Content: day.AddDate(0, 0, i).UnixMilli(), IsNotEmpty: true},
				})
				images.Values = append(images.Values, &av.Value{ID: ast.NewNodeID(), KeyID: images.Key.ID,
					BlockID: id, Type: av.KeyTypeMAsset,
					MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Content: "assets/" + name + ".png"}}})
			}
			genAttrViewGroups(view, attrView)
			if len(view.Groups) == 0 {
				t.Fatal("dynamic group fixture was not generated")
			}
			group := view.Groups[0]
			if mode == "template" {
				group.GroupItemIDs = view.ItemIDs[:1]
			} else {
				// 日期分组跨日后重新计算成员，同时保留仍存在的分组 ID。
				attrView.KeyValues[1].Values[1].Date.Content = day.UnixMilli()
				view.GroupCreated = time.Now().AddDate(0, 0, -1).UnixMilli()
			}
			if err := av.SaveAttributeView(attrView); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(util.DataDir, "storage", "av", attrView.ID+".json")
			before, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Set(RoleContextKey, RoleAdministrator)
			got, err := GetCurrentAttributeViewImages(context, attrView.ID, "", view.ID, "", group.ID)
			want := []string{"assets/first.png", "assets/second.png"}
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("dynamic group images: %v, %v; want %v", got, err, want)
			}
			after, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("dynamic image preview wrote database: %v", err)
			}
		})
	}
}
