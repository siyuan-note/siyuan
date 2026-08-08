// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package search

import (
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
	pos = -1
	reg, err := compileHighlightingRegexp(keywords, caseSensitive, splitWords)
	if err != nil {
		ret = html.EscapeString(text)
		return
	}

	indexes := reg.FindAllStringIndex(text, -1)
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
	return
}

func compileHighlightingRegexp(keywords []string, caseSensitive, splitWords bool) (ret *regexp.Regexp, err error) {
	ic := "(?i)"
	if caseSensitive {
		ic = "(?)"
	}

	var re strings.Builder
	re.WriteString(ic + "(")
	for i, k := range keywords {
		if "" == k {
			continue
		}

		wordBoundary := false
		if splitWords {
			wordBoundary = lex.IsASCIILetterNums(gulu.Str.ToBytes(k)) // Improve virtual reference split words https://github.com/siyuan-note/siyuan/issues/7833
		}
		if !util.SearchHanSensitive {
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
