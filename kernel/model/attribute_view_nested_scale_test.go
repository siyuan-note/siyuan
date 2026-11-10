// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestNestedScaleAndTemplateEvaluation(t *testing.T) {
	for _, shape := range []string{"roots-page", "wide-page", "deep", "comb", "many-expanded", "groups"} {
		t.Run(shape, func(t *testing.T) {
			count := 10000
			if shape == "many-expanded" {
				count = 10200
			}
			database, ids := nestedFixture(t, count)
			parents := map[string]string{}
			expanded := []string{}
			var target *AttributeViewRenderTarget
			pageSize := 50
			switch shape {
			case "wide-page":
				for _, id := range ids[1:] {
					parents[id] = ids[0]
				}
				expanded = []string{ids[0]}
			case "deep":
				for i := 1; i < len(ids); i++ {
					parents[ids[i]] = ids[i-1]
				}
				target = &AttributeViewRenderTarget{ItemID: ids[len(ids)-1], Status: "filtered"}
			case "comb":
				for i := 1; i < len(ids)/2; i++ {
					parents[ids[i]] = ids[i-1]
				}
				for i := len(ids) / 2; i < len(ids); i++ {
					parents[ids[i]] = ids[i-len(ids)/2]
				}
				target = &AttributeViewRenderTarget{ItemID: ids[len(ids)-1], Status: "filtered"}
			case "many-expanded":
				pageSize = 200
				expanded = append(expanded, ids[:200]...)
				for i := 200; i < len(ids); i++ {
					parents[ids[i]] = ids[(i-200)/50]
				}
			case "groups":
				groupKey := database.KeyValues[1].Key
				for i, id := range ids {
					database.KeyValues[1].Values = append(database.KeyValues[1].Values, &av.Value{ID: ast.NewNodeID(), KeyID: groupKey.ID, BlockID: id, Type: groupKey.Type, MSelect: []*av.ValueSelect{{Content: fmt.Sprintf("Group %02d", i%100)}}})
				}
				database.Views[0].Group = &av.ViewGroup{Field: groupKey.ID, Method: av.GroupMethodValue}
			}
			if err := database.SetSubItemsParents(parents); err != nil {
				t.Fatal(err)
			}
			key := av.NewKey(ast.NewNodeID(), "Display", "", av.KeyTypeTemplate)
			key.Template = `.action{printf "computed"}`
			values := &av.KeyValues{Key: key}
			for _, id := range ids {
				values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: key.Type, Template: &av.ValueTemplate{Content: "unevaluated"}})
			}
			database.KeyValues = append(database.KeyValues, values)
			database.Views[0].Table.Columns = append(database.Views[0].Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			started := time.Now()
			view := nestedRender(t, database, "", 1, pageSize, target, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: expanded}})
			elapsed := time.Since(started)
			payload, err := json.Marshal(view)
			if err != nil {
				t.Fatal(err)
			}
			runtime.ReadMemStats(&after)
			visible := len(view.Rows)
			for _, group := range view.Groups {
				visible += len(av.TableFromViewable(group).Rows)
			}
			evaluated := 0
			for _, value := range values.Values {
				if value.Template.Content == "computed" {
					evaluated++
				}
			}
			if evaluated != visible {
				t.Fatalf("off-page template evaluation: evaluated=%d visible=%d", evaluated, visible)
			}
			if target != nil && target.Status != "visible" {
				t.Fatal("scale target not visible")
			}
			if shape == "roots-page" && visible != 50 {
				t.Fatal("root page unbounded")
			}
			if shape == "wide-page" && visible != 51 {
				t.Fatal("child page unbounded")
			}
			t.Logf("%s: source=%d visible=%d templates=%d render=%s response=%d bytes allocation=%d bytes", shape, count, visible, evaluated, elapsed, len(payload), after.TotalAlloc-before.TotalAlloc)
		})
	}
}
