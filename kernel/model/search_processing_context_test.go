// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

type searchProcessingCancelContext struct {
	context.Context
	cancel context.CancelFunc
	checks atomic.Int32
}

func (ctx *searchProcessingCancelContext) Err() error {
	if ctx.checks.Add(1) >= 10 {
		ctx.cancel()
	}
	return ctx.Context.Err()
}

func TestSearchProcessingContextStopsWithinOneBlock(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search.Store(conf.NewSearch())
	t.Cleanup(func() { Conf = previous })
	for _, field := range []string{"content", "path", "alias"} {
		t.Run(field, func(t *testing.T) {
			block := &sql.Block{ID: "one-block", Type: "p"}
			content := strings.Repeat("value & ", 200000)
			switch field {
			case "content":
				block.Content = content
			case "path":
				block.HPath = content
			case "alias":
				block.Alias = content
			}
			base, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &searchProcessingCancelContext{Context: base, cancel: cancel}
			blocks := []*sql.Block{block}
			if got := fromSQLBlocksContext(ctx, &blocks, "missing", 36); len(got) != 0 || base.Err() == nil {
				t.Fatalf("canceled block formatting completed: count=%d err=%v", len(got), base.Err())
			}
		})
	}
}

func TestSearchProcessingKeepsHighlightAndRequestedScores(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search.Store(conf.NewSearch())
	t.Cleanup(func() { Conf = previous })
	for _, text := range []string{"alpha & beta alpha", "A&B", "诗經", "plain", "__@mark__alpha__mark@__"} {
		for _, keyword := range []string{"alpha", "&", "诗经", ""} {
			want, score := markSearch(text, keyword, 36)
			ctx, cancel := context.WithCancel(context.Background())
			got, gotScore := markSearchContext(ctx, text, keyword, 36, true)
			textOnly, _ := markSearchContext(ctx, text, keyword, 36, false)
			cancel()
			if got != want || gotScore != score || textOnly != want {
				t.Fatalf("context or score omission changed presentation: text=%q keyword=%q", text, keyword)
			}
		}
	}
}
