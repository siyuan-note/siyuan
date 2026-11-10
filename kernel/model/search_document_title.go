// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"regexp"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 标题替换在可见文字上匹配，跨样式的替换文字继承命中起点的行级载体。
// 资源地址、备注内容和引用身份不是标题文字，不参与匹配或被摘要覆盖。
func replaceDocumentTitleText(root *ast.Node, method int, keyword, replacement string, expression *regexp.Regexp) (bool, error) {
	paragraph, err := treenode.DocumentTitleParagraph(root)
	if err != nil {
		return false, err
	}
	type fragment struct {
		start, end int
		text       string
		set        func(string)
	}
	var fragments []*fragment
	var content strings.Builder
	ast.Walk(paragraph, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		var text string
		var set func(string)
		switch node.Type {
		case ast.NodeText, ast.NodeLinkText, ast.NodeBackslashContent, ast.NodeEmojiUnicode,
			ast.NodeEmojiAlias, ast.NodeCodeSpanContent, ast.NodeInlineMathContent:
			text = string(node.Tokens)
			set = func(value string) { node.Tokens = []byte(value) }
		case ast.NodeHTMLEntity:
			text = util.UnescapeHTML(string(node.Tokens))
			set = func(value string) { node.Type, node.Tokens = ast.NodeText, []byte(value) }
		case ast.NodeTextMark:
			if node.IsTextMarkType("inline-math") {
				text = util.UnescapeHTML(node.TextMarkInlineMathContent)
				set = func(value string) { node.TextMarkInlineMathContent = util.EscapeHTML(value) }
			} else {
				text = util.UnescapeHTML(node.TextMarkTextContent)
				set = func(value string) {
					node.TextMarkTextContent = util.EscapeHTML(value)
					if treenode.IsBlockRef(node) {
						node.TextMarkBlockRefSubtype = "s"
					}
				}
			}
		case ast.NodeSoftBreak, ast.NodeHardBreak, ast.NodeBr:
			text = " "
			set = func(value string) { node.Type, node.Tokens = ast.NodeText, []byte(value) }
		}
		if set == nil {
			return ast.WalkContinue
		}
		text = strings.ReplaceAll(strings.ReplaceAll(text, "\r", " "), "\n", " ")
		start := content.Len()
		content.WriteString(text)
		fragments = append(fragments, &fragment{start: start, end: content.Len(), text: text, set: set})
		return ast.WalkSkipChildren
	})
	text := content.String()
	matches := findReplaceTextMatchIndexes(text, method, keyword, expression)
	if len(matches) == 0 {
		return false, nil
	}
	if len(fragments) == 0 {
		value, _ := replaceSearchText(text, method, keyword, replacement, expression)
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(value)})
	} else {
		for index := len(matches) - 1; index >= 0; index-- {
			match := matches[index]
			value := replacement
			if method == 3 {
				value = string(expression.ExpandString(nil, replacement, text, match))
			}
			inserted := false
			for _, fragment := range fragments {
				if fragment.end <= match[0] && !(match[0] == len(text) && fragment.end == len(text)) || fragment.start > match[1] {
					continue
				}
				start, end := max(0, match[0]-fragment.start), min(fragment.end-fragment.start, match[1]-fragment.start)
				if start > end || start > len(fragment.text) {
					continue
				}
				addition := ""
				if !inserted {
					addition, inserted = value, true
				}
				fragment.text = fragment.text[:start] + addition + fragment.text[end:]
				if fragment.end >= match[1] {
					break
				}
			}
		}
		for _, fragment := range fragments {
			if fragment.text != text[fragment.start:fragment.end] {
				fragment.set(fragment.text)
			}
		}
	}
	before := treenode.DocumentTitleRevision(root)
	if err = treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
		return false, err
	}
	return before != treenode.DocumentTitleRevision(root), nil
}
