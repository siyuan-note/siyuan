// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"regexp"
	"strings"
	"text/template/parse"

	"github.com/siyuan-note/siyuan/kernel/av"
)

var reusableTemplateFormat = regexp.MustCompile(`%(?:%|[-+# 0]*[0-9]*(?:\.[0-9]+)?[svdf])`)

// IsReusableTemplateKey 仅接纳封闭的字段访问和字符串格式化，不依赖时间、SQL 或外部状态。
func IsReusableTemplateKey(attrView *av.AttributeView, key *av.Key) bool {
	if _, known := StaticTemplateKeyDependencies(attrView, key); !known {
		return false
	}
	content := key.Template
	if key.Type != av.KeyTypeTemplate {
		content = key.RenderTemplate
	}
	tpl, err := compileTemplateField(content)
	if err != nil || !reusableTemplateNode(tpl.Tree.Root) {
		return false
	}
	variables, err := getTemplateVars(content)
	if err != nil {
		return false
	}
	for _, variable := range variables {
		if strings.HasSuffix(variable, "_raw") || strings.HasSuffix(variable, "_created") || strings.HasSuffix(variable, "_end") {
			return false
		}
		known := false
		for _, values := range attrView.KeyValues {
			if values != nil && values.Key != nil && (variable == values.Key.ID || variable == values.Key.Name) {
				known = true
			}
		}
		if !known {
			return false
		}
	}
	return true
}

func reusableTemplateNode(node parse.Node) bool {
	if node == nil {
		return true
	}
	switch current := node.(type) {
	case *parse.ListNode:
		for _, child := range current.Nodes {
			if !reusableTemplateNode(child) {
				return false
			}
		}
	case *parse.ActionNode:
		return reusableTemplateNode(current.Pipe)
	case *parse.PipeNode:
		for _, command := range current.Cmds {
			if !reusableTemplateNode(command) {
				return false
			}
		}
	case *parse.CommandNode:
		if len(current.Args) > 0 && current.Args[0].Type() == parse.NodeIdentifier {
			name := current.Args[0].String()
			if name == "printf" {
				if len(current.Args) < 2 || current.Args[1].Type() != parse.NodeString || strings.Contains(reusableTemplateFormat.ReplaceAllString(current.Args[1].(*parse.StringNode).Text, ""), "%") {
					return false
				}
			} else if name == "index" {
				if len(current.Args) != 3 || current.Args[2].Type() != parse.NodeString ||
					(current.Args[1].Type() != parse.NodeDot && !isTemplateIDModField(current.Args[1])) {
					return false
				}
			} else if name != "print" && name != "println" {
				return false
			}
		}
		for _, argument := range current.Args {
			if !reusableTemplateNode(argument) {
				return false
			}
		}
	case *parse.FieldNode:
		if isTemplateIDModField(current) {
			return current.Ident[0] == "id_mod" && len(current.Ident) <= 2
		}
		return len(current.Ident) == 1
	}
	return true
}

// StaticTemplateKeyDependencies 复用字段依赖解析，仅为可静态识别的表达式返回完整依赖。
// 分支、命名模板、变量别名或动态访问保留完整求值路径，避免将遗漏依赖当成显示字段。
func StaticTemplateKeyDependencies(attrView *av.AttributeView, key *av.Key) ([]*av.Key, bool) {
	if attrView == nil || key == nil {
		return nil, false
	}
	content := key.Template
	if key.Type != av.KeyTypeTemplate {
		content = key.RenderTemplate
	}
	tpl, err := compileTemplateField(content)
	if err != nil || tpl == nil || tpl.Tree == nil || !staticTemplateNode(tpl.Tree.Root) {
		return nil, false
	}
	return GetTemplateKeyRelevantKeys(attrView, key), true
}

func staticTemplateNode(node parse.Node) bool {
	if node == nil {
		return true
	}
	switch n := node.(type) {
	case *parse.ListNode:
		for _, child := range n.Nodes {
			if !staticTemplateNode(child) {
				return false
			}
		}
		return true
	case *parse.ActionNode:
		return staticTemplateNode(n.Pipe)
	case *parse.PipeNode:
		if len(n.Decl) != 0 {
			return false
		}
		for _, command := range n.Cmds {
			if !staticTemplateNode(command) {
				return false
			}
		}
		return true
	case *parse.CommandNode:
		if len(n.Args) >= 2 && n.Args[0].Type() == parse.NodeIdentifier && n.Args[0].String() == "index" &&
			isTemplateIDModField(n.Args[1]) && len(n.Args[1].(*parse.FieldNode).Ident) != 1 {
			return false
		}
		// 字面索引的根对象不代表依赖全部字段。
		if len(n.Args) >= 3 && n.Args[0].Type() == parse.NodeIdentifier && n.Args[0].String() == "index" &&
			n.Args[2].Type() == parse.NodeString {
			if n.Args[1].Type() == parse.NodeDot {
				name := n.Args[2].(*parse.StringNode).Text
				if name == "id_mod" || name == "id_mod_raw" {
					return false
				}
			}
			staticRoot := n.Args[1].Type() == parse.NodeDot || isTemplateIDModField(n.Args[1])
			if staticRoot {
				for i, argument := range n.Args {
					if i != 1 && !staticTemplateNode(argument) {
						return false
					}
				}
				return true
			}
		}
		for _, argument := range n.Args {
			if !staticTemplateNode(argument) {
				return false
			}
		}
		return true
	case *parse.FieldNode:
		return len(n.Ident) > 0 && !((n.Ident[0] == "id_mod" || n.Ident[0] == "id_mod_raw") && len(n.Ident) == 1)
	case *parse.TextNode, *parse.StringNode, *parse.NumberNode, *parse.BoolNode, *parse.NilNode, *parse.IdentifierNode:
		return true
	default:
		return false
	}
}
