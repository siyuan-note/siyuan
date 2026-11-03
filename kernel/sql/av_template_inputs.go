// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"text/template"
	"text/template/parse"
)

// templateInputSignature 对实际输入取指纹；局部点上下文由其来源整体覆盖，动态根访问保守覆盖全部输入。
func templateInputSignature(tpl *template.Template, data map[string]any) (string, bool) {
	inputs := map[string]any{}
	cacheable := true
	add := func(path []string) {
		var value any = data
		for _, name := range path {
			object, ok := value.(map[string]any)
			if !ok {
				break
			}
			value = object[name]
		}
		key, _ := json.Marshal(path)
		inputs[string(key)] = templateInputValue(value)
	}
	var walk func(parse.Node, bool)
	walk = func(node parse.Node, root bool) {
		if node == nil {
			return
		}
		switch n := node.(type) {
		case *parse.ListNode:
			if n != nil {
				for _, child := range n.Nodes {
					walk(child, root)
				}
			}
		case *parse.ActionNode:
			walk(n.Pipe, root)
		case *parse.PipeNode:
			if n != nil {
				for _, command := range n.Cmds {
					walk(command, root)
				}
			}
		case *parse.CommandNode:
			// 静态 index 单独读取目标字段，避免把整个 id_mod 当作依赖。
			if len(n.Args) >= 3 {
				identifier, ok := n.Args[0].(*parse.IdentifierNode)
				if ok && identifier.Ident == "index" && root {
					var path []string
					known := false
					switch target := n.Args[1].(type) {
					case *parse.FieldNode:
						path, known = append(path, target.Ident...), true
					case *parse.DotNode:
						known = true
					}
					for _, arg := range n.Args[2:] {
						key, literal := arg.(*parse.StringNode)
						if !literal {
							known = false
							break
						}
						path = append(path, key.Text)
					}
					if known {
						add(path)
						return
					}
				}
			}
			for _, arg := range n.Args {
				walk(arg, root)
			}
		case *parse.IdentifierNode:
			switch n.Ident {
			case "queryBlocks", "getBlock", "querySpans", "querySQL", "getHPathByID", "statBlock":
				// 外部块及查询结果不属于当前行输入，不能据此判定为无关更新。
				cacheable = false
			}
		case *parse.FieldNode:
			if root {
				add(n.Ident)
			}
		case *parse.VariableNode:
			if len(n.Ident) > 0 && n.Ident[0] == "$" {
				add(n.Ident[1:])
			}
		case *parse.DotNode:
			if root {
				add(nil)
			}
		case *parse.ChainNode:
			walk(n.Node, root)
		case *parse.IfNode:
			walk(n.Pipe, root)
			walk(n.List, root)
			walk(n.ElseList, root)
		case *parse.WithNode:
			walk(n.Pipe, root)
			walk(n.List, false)
			walk(n.ElseList, root)
		case *parse.RangeNode:
			walk(n.Pipe, root)
			walk(n.List, false)
			walk(n.ElseList, root)
		case *parse.TemplateNode:
			add(nil)
		}
	}
	walk(tpl.Tree.Root, true)
	if !cacheable {
		return "", false
	}
	raw, err := json.Marshal(inputs)
	if err != nil {
		return "", false
	}
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]), true
}

func templateInputValue(value any) any {
	typeName := fmt.Sprintf("%T", value)
	if object, ok := value.(map[string]any); ok {
		fields := make(map[string]any, len(object))
		for name, field := range object {
			fields[name] = templateInputValue(field)
		}
		value = fields
	}
	return []any{typeName, value}
}
