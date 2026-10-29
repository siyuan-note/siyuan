// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package search

import (
	"context"
	"regexp"
	"unicode/utf8"
)

const highlightingWindowBytes = 64 * 1024

// findHighlightingMatchesContext 用于不带词边界的字面高亮表达式，繁简及大小写等价类仍各匹配一个字符。
// 窗口保留完整关键字的重叠区，只接纳窗口内开始的匹配，避免截断跨窗口关键字。
func findHighlightingMatchesContext(ctx context.Context, expression *regexp.Regexp, text string, keywords []string) (matches [][]int) {
	lookahead := 0
	for _, keyword := range keywords {
		characters := utf8.RuneCountInString(keyword)
		if characters >= len(text)/utf8.UTFMax {
			lookahead = len(text)
			break
		}
		lookahead = max(lookahead, characters*utf8.UTFMax)
	}
	previousEnd := -1
	for offset := 0; offset <= len(text); {
		if ctx.Err() != nil {
			return nil
		}
		boundary := offset + min(highlightingWindowBytes, len(text)-offset)
		for adjustment := 0; adjustment < utf8.UTFMax-1 && boundary < len(text) && !utf8.RuneStart(text[boundary]); adjustment++ {
			boundary++
		}
		end := boundary + min(lookahead, len(text)-boundary)
		for adjustment := 0; adjustment < utf8.UTFMax-1 && end < len(text) && !utf8.RuneStart(text[end]); adjustment++ {
			end++
		}
		match := expression.FindStringIndex(text[offset:end])
		if ctx.Err() != nil {
			return nil
		}
		if match == nil || (offset+match[0] >= boundary && boundary < len(text)) {
			if boundary == len(text) {
				return matches
			}
			offset = boundary
			continue
		}
		start, finish := offset+match[0], offset+match[1]
		// 连续匹配的交界可能再次报告空匹配，沿用 regexp 对相邻空匹配的抑制规则。
		if start != finish || finish != previousEnd {
			match[0], match[1] = start, finish
			matches = append(matches, match)
		}
		previousEnd = finish
		offset = finish
		if start == finish {
			if offset == len(text) {
				return matches
			}
			_, size := utf8.DecodeRuneInString(text[offset:])
			offset += size
		}
	}
	return
}
