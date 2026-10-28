// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package search

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type highlightingCancelContext struct {
	context.Context
	cancel context.CancelFunc
	checks atomic.Int32
	after  int32
}

func (ctx *highlightingCancelContext) Err() error {
	if ctx.checks.Add(1) >= ctx.after {
		ctx.cancel()
	}
	return ctx.Context.Err()
}

func TestMarkTextContextMatchesCompleteHighlighting(t *testing.T) {
	previous := util.SearchHanSensitive.Load()
	t.Cleanup(func() { util.SearchHanSensitive.Store(previous) })
	cases := []struct {
		name, text, keyword string
	}{
		{"window boundary", strings.Repeat("x", highlightingWindowBytes-2) + "alpha end", "alpha"},
		{"unicode boundary", strings.Repeat("x", highlightingWindowBytes-1) + "🙂诗經 & tail", "🙂诗经"},
		{"many matches", strings.Repeat("ababc <&> Kk ", 20000), "ab" + TermSep + "abc" + TermSep + "k"},
		{"empty matches", strings.Repeat("🙂x", 1500), " "},
		{"no matches", strings.Repeat("&🙂", highlightingWindowBytes), "missing"},
		{"invalid UTF8", strings.Repeat("x\xff", highlightingWindowBytes), "x"},
		{"empty input", "", "a"},
		{"empty keyword", "A&B", ""},
	}
	random := rand.New(rand.NewSource(20692))
	words := []string{"ab", "abc", "诗經", "🙂", "K", "&", "\x00", "\xff"}
	for i := range 16 {
		var content strings.Builder
		for content.Len() < highlightingWindowBytes+i {
			content.WriteString(words[random.Intn(len(words))])
		}
		cases = append(cases, struct{ name, text, keyword string }{
			fmt.Sprintf("mixed-%d", i), content.String(), words[i%len(words)] + TermSep + "ab",
		})
	}
	for _, hanSensitive := range []bool{true, false} {
		util.SearchHanSensitive.Store(hanSensitive)
		for _, test := range cases {
			for _, beforeLen := range []int{-1, 1, 36} {
				t.Run(fmt.Sprintf("%t/%s/%d", hanSensitive, test.name, beforeLen), func(t *testing.T) {
					for _, caseSensitive := range []bool{true, false} {
						wantPos, want := MarkText(test.text, test.keyword, beforeLen, caseSensitive)
						ctx, cancel := context.WithCancel(context.Background())
						gotPos, got := MarkTextContext(ctx, test.text, test.keyword, beforeLen, caseSensitive)
						cancel()
						if gotPos != wantPos || got != want {
							t.Fatalf("context changed highlight: position %d/%d, bytes %d/%d, case=%t",
								gotPos, wantPos, len(got), len(want), caseSensitive)
						}
					}
				})
			}
		}
	}
}

func TestMarkTextContextStopsInsideLargeValues(t *testing.T) {
	for _, keyword := range []string{"hit", "missing"} {
		t.Run(keyword, func(t *testing.T) {
			base, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &highlightingCancelContext{Context: base, cancel: cancel, after: 10}
			pos, marked := MarkTextContext(ctx, strings.Repeat("hit & ", 200000), keyword, -1, true)
			if base.Err() == nil || pos != -1 || marked != "" {
				t.Fatalf("large value was completed after cancellation: err=%v pos=%d bytes=%d", base.Err(), pos, len(marked))
			}
			if ctx.checks.Load() > ctx.after+2 {
				t.Fatalf("canceled highlighting continued checking: %d", ctx.checks.Load())
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if pos, marked := MarkTextContext(ctx, "plain", "", 0, true); pos != -1 || marked != "" {
		t.Fatal("empty keyword ignored cancellation")
	}
}

func FuzzMarkTextContextMatchesComplete(f *testing.F) {
	f.Add("ababc ab & alpha", "ab"+TermSep+"abc", true)
	f.Add(strings.Repeat("x", highlightingWindowBytes-2)+"🙂alpha", "🙂alpha", false)
	f.Add(strings.Repeat("🙂", 2000), " ", false)
	f.Add("Kk詩經 &\x00\xff", "k"+TermSep+"诗经", false)
	f.Fuzz(func(t *testing.T, text, keyword string, caseSensitive bool) {
		if len(text) > 256*1024 || len(keyword) > 64 {
			t.Skip()
		}
		wantPos, want := MarkText(text, keyword, 36, caseSensitive)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		gotPos, got := MarkTextContext(ctx, text, keyword, 36, caseSensitive)
		if gotPos != wantPos || got != want {
			t.Fatalf("context changed highlight: position %d/%d, bytes %d/%d", gotPos, wantPos, len(got), len(want))
		}
	})
}

func BenchmarkMarkTextContext(b *testing.B) {
	for _, repeat := range []int{20, 20000} {
		text := strings.Repeat("alpha & beta ", repeat)
		for _, cancellable := range []bool{false, true} {
			b.Run(fmt.Sprintf("repeats_%d/cancellable_%t", repeat, cancellable), func(b *testing.B) {
				var ctx context.Context = context.Background()
				if cancellable {
					var cancel context.CancelFunc
					ctx, cancel = context.WithCancel(ctx)
					b.Cleanup(cancel)
				}
				b.ReportAllocs()
				for b.Loop() {
					if pos, _ := MarkTextContext(ctx, text, "alpha", 36, true); pos < 0 {
						b.Fatal("missing highlight")
					}
				}
			})
		}
	}
}
