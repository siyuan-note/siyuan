package treenode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

const TableCellRichDocumentSpec = "4"
const TableCellRichTableAttribute = "custom-sy-table-rich"

func checkTableCellRichJSON(data []byte, spec string) error {
	type rawNode struct {
		Type          string
		TableCellRich json.RawMessage
		Children      []json.RawMessage
	}
	var check func(json.RawMessage, string) error
	check = func(raw json.RawMessage, context string) error {
		var node rawNode
		if err := json.Unmarshal(raw, &node); nil != err {
			return err
		}
		if len(node.TableCellRich) > 0 {
			if !utf8.Valid(node.TableCellRich) {
				return fmt.Errorf("table cell rich text payload is not UTF-8")
			}
			version, _ := strconv.Atoi(spec)
			if version < 4 || node.Type != "NodeTableCell" || context != "row" {
				return fmt.Errorf("invalid table cell rich text document spec [%s]", spec)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(node.TableCellRich, &fields); nil != err || len(fields) != 3 {
				return fmt.Errorf("invalid table cell rich text payload")
			}
			for _, name := range []string{"spec", "format", "content"} {
				if len(fields[name]) == 0 || bytes.Equal(bytes.TrimSpace(fields[name]), []byte("null")) {
					return fmt.Errorf("missing table cell rich text field [%s]", name)
				}
			}
			var rich ast.TableCellRich
			if err := json.Unmarshal(node.TableCellRich, &rich); nil != err {
				return err
			}
			if _, err := av.ParseTableCellRich(&rich); nil != err {
				return err
			}
		}
		childContext := ""
		switch node.Type {
		case "NodeTable":
			childContext = "table"
		case "NodeTableHead":
			if context == "table" {
				childContext = "head"
			}
		case "NodeTableRow":
			if context == "table" || context == "head" {
				childContext = "row"
			}
		}
		for _, child := range node.Children {
			if err := check(child, childContext); nil != err {
				return err
			}
		}
		return nil
	}
	return check(data, "")
}

// HasTableCellRich 判断子树是否包含富文本单元格。
func HasTableCellRich(root *ast.Node) (ret bool) {
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && nil != n.TableCellRich {
			ret = true
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

// ValidateTableCellRich 检查富文本源，未知格式和损坏数据不降级为行内内容。
func ValidateTableCellRich(root *ast.Node) (err error) {
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || nil == n.TableCellRich {
			return ast.WalkContinue
		}
		if ast.NodeTableCell != n.Type || !n.ParentIs(ast.NodeTableRow) ||
			!(n.Parent.ParentIs(ast.NodeTable) || n.Parent.ParentIs(ast.NodeTableHead) && n.Parent.Parent.ParentIs(ast.NodeTable)) {
			err = fmt.Errorf("rich text source belongs to a table cell")
			return ast.WalkStop
		}
		if _, err = av.ParseTableCellRich(n.TableCellRich); nil != err {
			return ast.WalkStop
		}
		return ast.WalkSkipChildren
	})
	return
}

// RefreshTableCellRichProjection 在源验证成功后重建行内投影，不修改源数据。
func RefreshTableCellRichProjection(root *ast.Node) (err error) {
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || nil == n.TableCellRich {
			return ast.WalkContinue
		}
		var fragment *parse.Tree
		if fragment, err = av.ParseTableCellRich(n.TableCellRich); nil != err {
			return ast.WalkStop
		}
		projection := parse.ProjectTableCellRich(fragment)
		for nil != n.FirstChild {
			n.FirstChild.Unlink()
		}
		for nil != projection.FirstChild {
			n.AppendChild(projection.FirstChild)
		}
		for parent := n.Parent; nil != parent; parent = parent.Parent {
			if ast.NodeTable == parent.Type {
				parent.SetIALAttr(TableCellRichTableAttribute, "1")
				break
			}
		}
		return ast.WalkSkipChildren
	})
	return
}

// SyncTableCellRichInlineChanges 将内核对资源、引用和行内内容的改写同步到源，再刷新派生内容。
func SyncTableCellRichInlineChanges(root *ast.Node) (err error) {
	updates := map[*ast.Node]string{}
	ast.Walk(root, func(cell *ast.Node, entering bool) ast.WalkStatus {
		if !entering || nil == cell.TableCellRich {
			return ast.WalkContinue
		}
		var fragment *parse.Tree
		if fragment, err = av.ParseTableCellRich(cell.TableCellRich); nil != err {
			return ast.WalkStop
		}
		expected, sources := parse.ProjectTableCellRichWithSources(fragment)
		changed := false
		var sync func(*ast.Node, *ast.Node) error
		sync = func(want, actual *ast.Node) error {
			for ; want != nil && actual != nil; want, actual = want.Next, actual.Next {
				if want.Type != actual.Type {
					return fmt.Errorf("table cell rich text projection structure changed")
				}
				if !bytes.Equal(tableCellInlineSignature(want), tableCellInlineSignature(actual)) {
					origin := sources[want]
					if nil == origin {
						return fmt.Errorf("table cell rich text projection marker changed")
					}
					switch origin.Type {
					case ast.NodeCodeBlockCode:
						origin.Tokens = []byte(html.UnescapeString(actual.TextMarkTextContent) + "\n")
					case ast.NodeMathBlockContent:
						origin.Tokens = []byte(html.UnescapeString(actual.TextMarkInlineMathContent))
					default:
						parent, previous, next, first, last := origin.Parent, origin.Previous, origin.Next, origin.FirstChild, origin.LastChild
						*origin = *parse.CloneTableCellInline(actual)
						origin.Parent, origin.Previous, origin.Next, origin.FirstChild, origin.LastChild = parent, previous, next, first, last
					}
					changed = true
				}
				if e := sync(want.FirstChild, actual.FirstChild); nil != e {
					return e
				}
			}
			if want != nil || actual != nil {
				return fmt.Errorf("table cell rich text projection length changed")
			}
			return nil
		}
		if nil != cell.FirstChild {
			if err = sync(expected.FirstChild, cell.FirstChild); nil != err {
				return ast.WalkStop
			}
		}
		if changed {
			var content string
			if content, err = av.RenderTableCellRich(fragment); nil != err {
				return ast.WalkStop
			}
			updates[cell] = content
		}
		return ast.WalkSkipChildren
	})
	if nil != err {
		return
	}
	for cell, content := range updates {
		rich := *cell.TableCellRich
		rich.Content = content
		cell.TableCellRich = &rich
	}
	return RefreshTableCellRichProjection(root)
}

func tableCellInlineSignature(node *ast.Node) []byte {
	copy := *node
	copy.ID, copy.TypeStr, copy.Data = "", "", ""
	copy.Properties, copy.Children = nil, nil
	data, _ := json.Marshal(struct {
		Node   *ast.Node
		Tokens string
		IAL    [][]string
	}{&copy, node.TokensStr(), node.KramdownIAL})
	return data
}
