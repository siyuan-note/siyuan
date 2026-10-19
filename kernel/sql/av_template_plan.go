package sql

import (
	"text/template/parse"

	"github.com/siyuan-note/siyuan/kernel/av"
)

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
