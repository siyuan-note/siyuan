// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package search

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func MarkText(text string, keyword string, beforeLen int, caseSensitive bool) (pos int, marked string) {
	if "" == keyword {
		return -1, text
	}
	keywords := SplitKeyword(keyword)
	pos, marked, _ = encloseHighlightingRaw(text, keywords, "<mark>", "</mark>", caseSensitive, false, beforeLen)
	return
}

// MarkTextContext 在匹配和生成高亮期间检查请求取消，不返回未完成的高亮片段。
func MarkTextContext(ctx context.Context, text, keyword string, beforeLen int, caseSensitive bool) (pos int, marked string) {
	if ctx.Err() != nil {
		return -1, ""
	}
	if keyword == "" {
		return -1, text
	}
	pos, marked, _ = encloseHighlightingRawContext(ctx, text, SplitKeyword(keyword), "<mark>", "</mark>", caseSensitive, false, beforeLen)
	return
}

const (
	TermSep         = "__term@sep__"
	SearchMarkLeft  = "__@mark__"
	SearchMarkRight = "__mark@__"
)

func SplitKeyword(keyword string) (keywords []string) {
	keyword = strings.TrimSpace(keyword)
	if "" == keyword {
		return
	}
	words := strings.Split(keyword, TermSep)
	if 1 < len(words) {
		for _, word := range words {
			if "" == word {
				continue
			}
			keywords = append(keywords, word)
		}
	} else {
		keywords = append(keywords, keyword)
	}
	return
}

func EncloseHighlighting(text string, keywords []string, openMark, closeMark string, caseSensitive, splitWords bool) (ret string) {
	ret, _ = EncloseHighlightingRaw(text, keywords, openMark, closeMark, caseSensitive, splitWords)
	return
}

// EncloseHighlightingRaw 在原始文本中匹配关键字，并在插入高亮标记时转义文本。
func EncloseHighlightingRaw(text string, keywords []string, openMark, closeMark string, caseSensitive, splitWords bool) (ret string, matched bool) {
	_, ret, matched = encloseHighlightingRaw(text, keywords, openMark, closeMark, caseSensitive, splitWords, -1)
	return
}

// encloseHighlightingRaw 在原始文本上完成上下文截取和高亮，beforeLen 小于零时保留全部前文。
func encloseHighlightingRaw(text string, keywords []string, openMark, closeMark string, caseSensitive, splitWords bool, beforeLen int) (pos int, ret string, matched bool) {
	return encloseHighlightingRawContext(context.Background(), text, keywords, openMark, closeMark, caseSensitive, splitWords, beforeLen)
}

func encloseHighlightingRawContext(ctx context.Context, text string, keywords []string, openMark, closeMark string, caseSensitive, splitWords bool, beforeLen int) (pos int, ret string, matched bool) {
	pos = -1
	if ctx.Err() != nil {
		return
	}
	reg, err := compileHighlightingRegexp(keywords, caseSensitive, splitWords)
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		ret = html.EscapeString(text)
		return
	}

	var indexes [][]int
	if len(text) <= 4096 || ctx.Done() == nil || splitWords {
		indexes = reg.FindAllStringIndex(text, -1)
	} else {
		indexes = findHighlightingMatchesContext(ctx, reg, text, keywords)
	}
	if ctx.Err() != nil {
		return
	}
	if 1 > len(indexes) {
		ret = html.EscapeString(text)
		return
	}

	start := 0
	truncated := false
	if 0 <= beforeLen {
		start = indexes[0][0]
		var count int
		for 0 < start { // 关键字前面太长的话缩短一些
			if ctx.Err() != nil {
				return -1, "", false
			}
			_, size := utf8.DecodeLastRuneInString(text[:start])
			start -= size
			count++
			if beforeLen < count {
				truncated = true
				break
			}
		}
	}

	var buf strings.Builder
	buf.Grow(len(text) - start + len(indexes)*(len(openMark)+len(closeMark)))
	if truncated {
		buf.WriteString("...")
	}
	last := start
	for _, index := range indexes {
		if ctx.Err() != nil {
			return -1, "", false
		}
		buf.WriteString(html.EscapeString(text[last:index[0]]))
		if !matched {
			pos = buf.Len()
		}
		buf.WriteString(openMark)
		buf.WriteString(html.EscapeString(text[index[0]:index[1]]))
		buf.WriteString(closeMark)
		last = index[1]
		matched = true
	}
	buf.WriteString(html.EscapeString(text[last:]))
	ret = buf.String()

	// 避免反斜杠转义生成的高亮标签 https://github.com/siyuan-note/siyuan/issues/9790
	ret = strings.ReplaceAll(ret, "\\<span", "\\\\<span")
	if ctx.Err() != nil {
		return -1, "", false
	}
	return
}

func compileHighlightingRegexp(keywords []string, caseSensitive, splitWords bool) (ret *regexp.Regexp, err error) {
	ic := "(?i)"
	if caseSensitive {
		ic = "(?)"
	}

	var re strings.Builder
	re.WriteString(ic)
	re.WriteString("(")
	for i, k := range keywords {
		if "" == k {
			continue
		}

		wordBoundary := false
		if splitWords {
			wordBoundary = lex.IsASCIILetterNums(gulu.Str.ToBytes(k)) // Improve virtual reference split words https://github.com/siyuan-note/siyuan/issues/7833
		}
		if !util.SearchHanSensitive.Load() {
			// 不区分繁简：将关键字逐字符展开为繁简等价字符类，如 "诗经" -> "[诗詩][经經]"
			k = hanInsensitiveRegexp(k)
		} else {
			k = regexp.QuoteMeta(k)
		}
		re.WriteString("(")
		if wordBoundary {
			re.WriteString("\\b")
		}
		re.WriteString(k)
		if wordBoundary {
			re.WriteString("\\b")
		}
		re.WriteString(")")
		if i < len(keywords)-1 {
			re.WriteString("|")
		}
	}
	re.WriteString(")")
	ret, err = regexp.Compile(re.String())
	return
}

const (
	MarkDataType            = "search-mark"
	VirtualBlockRefDataType = "virtual-block-ref"
)

func GetMarkSpanStart(dataType string) string {
	return fmt.Sprintf("<span data-type=\"%s\">", dataType)
}

func GetMarkSpanEnd() string {
	return "</span>"
}
