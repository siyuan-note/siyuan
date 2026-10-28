// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func BenchmarkDatabaseTemplateDependencies(b *testing.B) {
	for _, size := range []int{1000, 10000, 50000} {
		for _, selective := range []bool{false, true} {
			name := "complete"
			if selective {
				name = "selective"
			}
			b.Run(fmt.Sprintf("rows_%d/%s", size, name), func(b *testing.B) {
				database, view := newTemplatePlanTestView(size, 5, av.LayoutTypeTable)
				b.ReportAllocs()
				b.ResetTimer()
				for range b.N {
					// 两条路径均重建集合，确保测量包含完整渲染和分页过程。
					clear(database.RenderedViewables)
					rendered, err := renderTemplatePlanTestView(database, view, selective, 50)
					if err != nil || rendered.(av.Collection).CountItems() != 50 {
						b.Fatalf("unexpected page: %v", err)
					}
				}
			})
		}
	}
}
