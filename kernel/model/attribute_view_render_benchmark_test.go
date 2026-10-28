// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func BenchmarkDatabaseDisplayPage(b *testing.B) {
	for _, size := range []int{1000, 10000, 50000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			attrView, view := newDeferredTemplateTestAttributeView()
			view.PageSize = 50
			view.ItemIDs = nil
			for _, keyValues := range attrView.KeyValues {
				keyValues.Values = nil
			}
			for i := range size {
				id := fmt.Sprintf("20261019000000-%07d", i)
				view.ItemIDs = append(view.ItemIDs, id)
				attrView.KeyValues[0].Values = append(attrView.KeyValues[0].Values, &av.Value{
					ID: id + "-block", KeyID: "block", BlockID: id, Type: av.KeyTypeBlock, IsDetached: true,
					Block: &av.ValueBlock{Content: "Baseline"},
				})
				attrView.KeyValues[1].Values = append(attrView.KeyValues[1].Values, &av.Value{
					ID: id + "-text", KeyID: "text", BlockID: id, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "Baseline"},
				})
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				renderContext := sql.NewAttributeViewRenderContext()
				viewable := sql.RenderViewWithDeferredTemplatesContext(attrView, view, "", false, renderContext)
				if _, _, err := renderViewableInstance(viewable, view, attrView, 1, 50, false, "", renderContext); err != nil {
					b.Fatal(err)
				}
				sql.FillAttributeViewTemplateValuesWithContext(attrView, view, viewable.(*av.Table), renderContext)
				if rows := viewable.(*av.Table).Rows; len(rows) != 50 || rows[0].GetValue("template").Template.Content != "Baseline" {
					b.Fatal("unexpected database page or template value")
				}
			}
			b.ReportMetric(float64(size), "rows/op")
		})
	}
}
