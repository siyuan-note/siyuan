// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func BenchmarkSearchProcessingContext(b *testing.B) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search.Store(conf.NewSearch())
	b.Cleanup(func() { Conf = previous })
	for _, repeat := range []int{20, 20000} {
		b.Run(fmt.Sprint(repeat), func(b *testing.B) {
			content := strings.Repeat("alpha & beta ", repeat)
			blocks := []*sql.Block{{ID: "block", Type: "p", Content: content, FContent: content,
				Name: "alpha", Alias: "beta", Memo: "alpha memo", Tag: "#alpha#", HPath: "/alpha/beta"}}
			ctx, cancel := context.WithCancel(context.Background())
			b.Cleanup(cancel)
			b.ReportAllocs()
			for b.Loop() {
				if result := fromSQLBlocksContext(ctx, &blocks, "alpha", 36); len(result) != 1 {
					b.Fatal("result formatting did not complete")
				}
			}
		})
	}
}
