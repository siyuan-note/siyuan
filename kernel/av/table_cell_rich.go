package av

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// ParseTableCellRich 复用数据库片段的格式校验，并保留普通表格已有的图片能力。
func ParseTableCellRich(rich *ast.TableCellRich) (*parse.Tree, error) {
	if nil == rich {
		return nil, fmt.Errorf("table cell rich text is missing")
	}
	if err := rich.Validate(); nil != err {
		return nil, err
	}
	_, tree, err := parseValueTextRichWithImages(&ValueTextRich{
		Spec: rich.Spec, Format: ValueTextRichFormat(rich.Format), Content: rich.Content,
	}, true)
	return tree, err
}

// RenderTableCellRich 将已校验的片段写回稳定的富文本源。
func RenderTableCellRich(tree *parse.Tree) (string, error) {
	if err := validateValueTextRichTreeWithImages(tree, true); nil != err {
		return "", err
	}
	content, _, err := normalizeValueTextRichTreeSourceWithImages(tree, true)
	return content, err
}

func isAllowedTableCellRichImageNode(node *ast.Node) bool {
	if ast.NodeBang == node.Type {
		return node.ParentIs(ast.NodeImage)
	}
	image := node
	if ast.NodeKramdownSpanIAL == node.Type {
		image = node.Previous
	}
	if nil == image || ast.NodeImage != image.Type {
		return false
	}
	for _, attribute := range image.KramdownIAL {
		if len(attribute) != 2 {
			return false
		}
		switch attribute[0] {
		case "title":
		case "style", "parent-style":
			style := strings.ToLower(attribute[1])
			if strings.ContainsAny(style, "\\<>@") || strings.Contains(style, "url") || strings.Contains(style, "expression") {
				return false
			}
		default:
			return false
		}
	}
	if ast.NodeKramdownSpanIAL == node.Type {
		for _, attribute := range parse.Tokens2IAL(node.Tokens) {
			if len(attribute) != 2 || image.IALAttr(attribute[0]) != attribute[1] {
				return false
			}
		}
	}
	return true
}
