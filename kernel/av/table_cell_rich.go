package av

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

var (
	tableCellRichCustomTypePattern     = regexp.MustCompile(`^custom_[A-Za-z0-9_-]{1,128}$`)
	tableCellRichCustomPropertyPattern = regexp.MustCompile(`^--custom-[a-z0-9-]{1,128}$`)
	tableCellRichCustomHexPattern      = regexp.MustCompile(`^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$`)
	tableCellRichCustomRGBPattern      = regexp.MustCompile(`(?i)^rgba?\(\s*(\d{1,3})(?:,\s*|\s+)(\d{1,3})(?:,\s*|\s+)(\d{1,3})(?:\s*[,/]\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$`)
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

func isTableCellRichCustomTextMark(node *ast.Node) bool {
	if nil == node || ast.NodeTextMark != node.Type {
		return false
	}
	for _, typ := range strings.Fields(node.TextMarkType) {
		if tableCellRichCustomTypePattern.MatchString(typ) {
			return true
		}
	}
	return false
}

func isAllowedTableCellRichCustomNode(node *ast.Node) bool {
	if nil == node {
		return false
	}
	if ast.NodeKramdownSpanIAL == node.Type {
		return isAllowedTableCellRichCustomSpanIAL(node)
	}
	if ast.NodeTextMark != node.Type || !isTableCellRichCustomTextMark(node) ||
		"" != node.TextMarkFlashcardOcclusionID || !isAllowedValueTextMarkReferenceData(node) {
		return false
	}
	for _, typ := range strings.Fields(node.TextMarkType) {
		if tableCellRichCustomTypePattern.MatchString(typ) {
			continue
		}
		standard := *node
		standard.TextMarkType = typ
		if !isAllowedValueTextMarkType(&standard) {
			return false
		}
	}
	if 1 > len(node.KramdownIAL) {
		return nil == node.Next || ast.NodeKramdownSpanIAL != node.Next.Type
	}
	return nil != node.Next && isAllowedTableCellRichCustomSpanIAL(node.Next)
}

func isAllowedTableCellRichCustomSpanIAL(node *ast.Node) bool {
	if nil == node || nil == node.Previous || !isTableCellRichCustomTextMark(node.Previous) {
		return false
	}
	markIAL := node.Previous.KramdownIAL
	spanIAL := parse.Tokens2IAL(node.Tokens)
	if 1 != len(markIAL) || 1 != len(spanIAL) || 2 != len(markIAL[0]) || 2 != len(spanIAL[0]) ||
		"style" != markIAL[0][0] || "style" != spanIAL[0][0] {
		return false
	}
	style := node.Previous.IALAttr("style")
	if "" == style || style != parse.IALVal(node, "style") {
		return false
	}
	_, ok := normalizeTableCellRichCustomStyle(style)
	return ok
}

func normalizeTableCellRichCustomStyle(style string) (string, bool) {
	if 2048 < len(style) {
		return "", false
	}
	declarations, ok := parseValueTextRichStyleDeclarations(style)
	if !ok {
		return "", false
	}
	var standard, custom []string
	for property, value := range declarations {
		if !tableCellRichCustomPropertyPattern.MatchString(property) {
			standard = append(standard, property+": "+value+";")
			continue
		}
		if !tableCellRichCustomHexPattern.MatchString(value) {
			rgb := tableCellRichCustomRGBPattern.FindStringSubmatch(value)
			if 4 == len(rgb) {
				for _, channel := range rgb[1:] {
					number, err := strconv.Atoi(channel)
					if nil != err || 255 < number {
						return "", false
					}
				}
			} else if normalized, valid := normalizeValueTextRichBuiltinPaletteValue("color", value); valid {
				value = normalized
			} else if normalized, valid = normalizeValueTextRichBuiltinPaletteValue("background-color", value); valid {
				value = normalized
			} else {
				return "", false
			}
		}
		custom = append(custom, property+": "+value+";")
	}
	sort.Strings(custom)
	if 0 < len(standard) {
		normalized, valid := normalizeValueTextRichStyle(strings.Join(standard, " "))
		if !valid {
			return "", false
		}
		standard = []string{normalized}
	}
	return strings.Join(append(standard, custom...), " "), true
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
