// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func BenchmarkDatabaseViewOrderReuse(b *testing.B) {
	for _, size := range []int{100, 1000, 10000, 50000} {
		for _, mode := range []string{"complete", "cold", "reused"} {
			b.Run(fmt.Sprintf("rows_%d/%s", size, mode), func(b *testing.B) {
				load := setupAttributeViewOrderReuseFixture(b, av.LayoutTypeTable, size, 5)
				initial := load()
				viewID := initial.Views[0].ID
				// 相同内容的非实时路径只关闭跨请求顺序复用，共用同一原始及规范化数据缓存。
				comparisonPath := filepath.Join(b.TempDir(), initial.ID+".json")
				data, err := os.ReadFile(filepath.Join(util.DataDir, "storage", "av", initial.ID+".json"))
				if err != nil {
					b.Fatal(err)
				}
				if err = os.WriteFile(comparisonPath, data, 0600); err != nil {
					b.Fatal(err)
				}
				if _, err = renderAttributeView(initial, "", viewID, "", "", 1, 50, nil, false, false, nil, ""); err != nil {
					b.Fatal(err)
				}
				if size >= 512 {
					probe := load()
					if _, err = renderAttributeView(probe, "", viewID, "", "", 2, 50, nil, false, false, nil, ""); err != nil {
						b.Fatal(err)
					}
					values, _ := probe.GetKeyValues("required")
					if values.Values[0].Template.Content != values.Key.Template {
						b.Fatal("benchmark order cache was not primed")
					}
				}
				b.ReportAllocs()
				b.ResetTimer()
				for i := range b.N {
					var database *av.AttributeView
					if mode == "complete" {
						database, err = av.ParseAttributeViewByPath(comparisonPath)
					} else {
						database = load()
					}
					if err != nil {
						b.Fatal(err)
					}
					if mode == "cold" {
						// 不同临时名称产生未命中的定义指纹，包含指纹计算与准入开销。
						database.Views[0].Name = fmt.Sprintf("cold-%d", i)
					}
					rendered, renderErr := renderAttributeView(database, "", viewID, "", "", 2, 50, nil, false, false, nil, "")
					if renderErr != nil || rendered.(av.Collection).CountItems() != 50 {
						b.Fatalf("unexpected page: %v", renderErr)
					}
				}
				b.StopTimer()
				b.ReportMetric(float64(size), "rows/op")
			})
		}
	}
}

func BenchmarkAttributeViewOrderFingerprint(b *testing.B) {
	for _, size := range []int{1000, 10000, 50000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			load := setupAttributeViewOrderReuseFixture(b, av.LayoutTypeTable, size, 5)
			database := load()
			view := database.Views[0]
			checkAttrView(database, view)
			upgradeAttributeViewSpec(database)
			b.ReportAllocs()
			for b.Loop() {
				if planAttributeViewOrderReuse(database, view, "", false) == nil {
					b.Fatal("eligible source did not produce a fingerprint")
				}
			}
			b.ReportMetric(float64(size), "rows/op")
		})
	}
}
