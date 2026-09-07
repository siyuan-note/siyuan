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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

const templateDocumentAttributeMarker = "siyuan-template-doc-attrs-v1"

func parseTemplateKTree(markdown []byte) (*parse.Tree, error) {
	engine := NewLute()
	tree := parse.Parse("", markdown, engine.ParseOptions)
	if tree == nil {
		return nil, errors.New("parse template tree failed")
	}
	normalizeTree(tree)
	if err := applyTemplateDocumentAttributes(tree); err != nil {
		return nil, err
	}
	return tree, nil
}

// 独立文档属性保留在原位置求值，渲染完成后再合并到根节点。
func applyTemplateDocumentAttributes(tree *parse.Tree) error {
	for node := tree.Root.FirstChild; node != nil; {
		next := node.Next
		info := node.ChildByType(ast.NodeCodeBlockFenceInfoMarker)
		if node.Type == ast.NodeCodeBlock && info != nil && string(info.CodeBlockInfo) == templateDocumentAttributeMarker {
			code := node.ChildByType(ast.NodeCodeBlockCode)
			if code == nil {
				return errors.New("invalid template document attributes")
			}
			source := strings.TrimSpace(string(code.Tokens))
			attrs := parseTemplateDocumentAttributes(source)
			if len(attrs) == 0 {
				return errors.New("invalid template document attributes")
			}
			for _, attr := range attrs {
				if attr[0] == "id" || attr[0] == "updated" {
					continue
				}
				tree.Root.RemoveIALAttr(attr[0])
				tree.Root.KramdownIAL = append(tree.Root.KramdownIAL, attr)
			}
			if next != nil && next.Type == ast.NodeKramdownBlockIAL && parse.IAL2Map(parse.Tokens2IAL(next.Tokens))["type"] != "doc" {
				ial := next
				next = next.Next
				ial.Unlink()
			}
			node.Unlink()
		}
		node = next
	}
	return nil
}

// 识别独立模板代码块中的文档属性，保留动作源码中的引号。
func templateDocumentAttributes(source []byte) [][]string {
	text := strings.TrimSpace(string(source))
	if !strings.HasPrefix(text, "{:") || !strings.HasSuffix(text, "}") {
		return nil
	}
	prefix := "siyuan_template_" + ast.NewNodeID() + "_"
	var actions []string
	var masked strings.Builder
	for {
		start := strings.Index(text, ".action{")
		if start < 0 {
			masked.WriteString(text)
			break
		}
		masked.WriteString(text[:start])
		end := start + len(".action{")
		var quote byte
		comment := false
		for ; end < len(text); end++ {
			c := text[end]
			if comment {
				if c == '*' && end+1 < len(text) && text[end+1] == '/' {
					comment = false
					end++
				}
				continue
			}
			if quote != 0 {
				if c == '\\' && quote != '`' {
					end++
					continue
				}
				if c == quote {
					quote = 0
				}
				continue
			}
			if c == '/' && end+1 < len(text) && text[end+1] == '*' {
				comment = true
				end++
				continue
			}
			if c == '"' || c == '\'' || c == '`' {
				quote = c
				continue
			}
			if c == '}' {
				break
			}
		}
		if end >= len(text) {
			return nil
		}
		actions = append(actions, text[start:end+1])
		masked.WriteString(prefix + strings.Repeat("x", len(actions)))
		text = text[end+1:]
	}
	attrs := parseTemplateDocumentAttributes(masked.String())
	for _, attr := range attrs {
		// 长占位符优先替换，避免前缀相同的动作相互覆盖。
		for i := len(actions) - 1; i >= 0; i-- {
			attr[1] = strings.ReplaceAll(attr[1], prefix+strings.Repeat("x", i+1), actions[i])
		}
	}
	return attrs
}

func parseTemplateDocumentAttributes(text string) [][]string {
	if !strings.HasPrefix(text, "{:") || !strings.HasSuffix(text, "}") {
		return nil
	}
	remaining := []byte(strings.TrimSuffix(strings.TrimPrefix(text, "{:"), "}"))
	var attrs [][]string
	isDoc := false
	for len(bytes.TrimSpace(remaining)) > 0 {
		valid, rest, attr, name, value := parse.TagAttr(remaining)
		if !valid || len(attr) == 0 {
			return nil
		}
		remaining = rest
		if string(name) == "type" && string(value) == "doc" {
			isDoc = true
		}
		attrs = append(attrs, []string{string(name), string(value)})
	}
	if !isDoc {
		return nil
	}
	return attrs
}
