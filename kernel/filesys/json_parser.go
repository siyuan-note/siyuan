// SiYuan - Refactor your thinking
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

package filesys

import (
	"bytes"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func ParseJSONWithoutFix(jsonData []byte, options *parse.Options) (ret *parse.Tree, err error) {
	root := &ast.Node{}
	err = unmarshalJSON(jsonData, root)
	if nil != err {
		return
	}

	ret = &parse.Tree{Name: "", ID: root.ID, Root: &ast.Node{Type: ast.NodeDocument, ID: root.ID, Spec: root.Spec}, Context: &parse.Context{ParseOption: options}}
	ret.Root.KramdownIAL = parse.Map2IAL(root.Properties)
	ret.Context.Tip = ret.Root
	if nil == root.Children {
		return
	}

	idMap := map[string]bool{}
	for _, child := range root.Children {
		genTreeByJSON(child, ret, &idMap, nil, nil, true)
	}
	return
}

func ParseJSON(jsonData []byte, options *parse.Options) (ret *parse.Tree, needFix bool, err error) {
	root := &ast.Node{}
	err = unmarshalJSON(jsonData, root)
	if nil != err {
		return
	}

	ret = &parse.Tree{Name: "", ID: root.ID, Root: &ast.Node{Type: ast.NodeDocument, ID: root.ID, Spec: root.Spec}, Context: &parse.Context{ParseOption: options}}
	ret.Root.KramdownIAL = parse.Map2IAL(root.Properties)
	for _, kv := range ret.Root.KramdownIAL {
		if strings.Contains(kv[1], "\n") {
			val := kv[1]
			val = strings.ReplaceAll(val, "\n", editor.IALValEscNewLine)
			ret.Root.SetIALAttr(kv[0], val)
			needFix = true
		}
	}

	ret.Context.Tip = ret.Root
	if nil == root.Children {
		newPara := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
		newPara.SetIALAttr("id", newPara.ID)
		ret.Root.AppendChild(newPara)
		needFix = true
		return
	}

	needMigrate2Spec1 := false
	idMap := map[string]bool{}
	for _, child := range root.Children {
		genTreeByJSON(child, ret, &idMap, &needFix, &needMigrate2Spec1, false)
	}

	if nil == ret.Root.FirstChild {
		// 如果是空文档的话挂一个空段落上去
		newP := treenode.NewParagraph()
		ret.Root.AppendChild(newP)
		ret.Root.SetIALAttr("updated", newP.ID[:14])
	}

	if needMigrate2Spec1 {
		parse.NestedInlines2FlattedSpans(ret, false)
		needFix = true
	}
	return
}

func genTreeByJSON(node *ast.Node, tree *parse.Tree, idMap *map[string]bool, needFix, needMigrate2Spec1 *bool, ignoreFix bool) {
	node.Tokens, node.Type = gulu.Str.ToBytes(node.Data), ast.Str2NodeType(node.TypeStr)
	node.Data, node.TypeStr = "", ""
	node.KramdownIAL = parse.Map2IAL(node.Properties)
	node.Properties = nil

	if !ignoreFix {
		// 历史数据订正

		if -1 == node.Type {
			*needFix = true
			node.Type = ast.NodeParagraph
			node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: node.Tokens})
			node.Children = nil
		}

		switch node.Type {
		case ast.NodeList:
			if 1 > len(node.Children) {
				*needFix = true
				return // 忽略空列表
			}
		case ast.NodeListItem:
			if 1 > len(node.Children) {
				*needFix = true
				return // 忽略空列表项
			}
		case ast.NodeBlockquote:
			if 2 > len(node.Children) {
				*needFix = true
				return // 忽略空引述
			}
		case ast.NodeSuperBlock:
			if 4 > len(node.Children) {
				*needFix = true
				return // 忽略空超级块
			}
		case ast.NodeMathBlock:
			if 1 > len(node.Children) {
				*needFix = true
				return // 忽略空公式
			}
		case ast.NodeBlockQueryEmbed:
			if 1 > len(node.Children) {
				*needFix = true
				return // 忽略空查询嵌入块
			}
		}

		fixLegacyData(tree.Context.Tip, node, idMap, needFix, needMigrate2Spec1)
	}

	tree.Context.Tip.AppendChild(node)
	tree.Context.Tip = node
	defer tree.Context.ParentTip()
	if nil == node.Children {
		return
	}
	for _, child := range node.Children {
		genTreeByJSON(child, tree, idMap, needFix, needMigrate2Spec1, ignoreFix)
	}
	node.Children = nil
}

func fixLegacyData(tip, node *ast.Node, idMap *map[string]bool, needFix, needMigrate2Spec1 *bool) {
	if node.IsBlock() {
		if "" == node.ID {
			node.ID = ast.NewNodeID()
			node.SetIALAttr("id", node.ID)
			*needFix = true
		}
		if 0 < len(node.Children) && ast.NodeBr.String() == node.Children[len(node.Children)-1].TypeStr {
			// 剔除块尾多余的软换行 https://github.com/siyuan-note/siyuan/issues/6191
			node.Children = node.Children[:len(node.Children)-1]
			*needFix = true
		}

		for _, kv := range node.KramdownIAL {
			if strings.Contains(kv[0], "custom-av-key-") {
				// TODO: 数据库正式上线以后移除这里的修复
				// 删除数据库属性键值对 https://github.com/siyuan-note/siyuan/issues/9293
				node.RemoveIALAttr(kv[0])
				*needFix = true
			}
		}
	}
	if "" != node.ID {
		if _, ok := (*idMap)[node.ID]; ok {
			node.ID = ast.NewNodeID()
			node.SetIALAttr("id", node.ID)
			*needFix = true
		}
		(*idMap)[node.ID] = true
	}

	switch node.Type {
	case ast.NodeIFrame:
		if bytes.Contains(node.Tokens, gulu.Str.ToBytes("iframe-content")) {
			start := bytes.Index(node.Tokens, gulu.Str.ToBytes("<iframe"))
			end := bytes.Index(node.Tokens, gulu.Str.ToBytes("</iframe>"))
			node.Tokens = node.Tokens[start : end+9]
			*needFix = true
		}
	case ast.NodeWidget:
		if bytes.Contains(node.Tokens, gulu.Str.ToBytes("http://127.0.0.1:6806")) {
			node.Tokens = bytes.ReplaceAll(node.Tokens, []byte("http://127.0.0.1:6806"), nil)
			*needFix = true
		}
	case ast.NodeList:
		if nil != node.ListData && 3 != node.ListData.Typ && 0 < len(node.Children) &&
			nil != node.Children[0].ListData && 3 == node.Children[0].ListData.Typ {
			node.ListData.Typ = 3
			*needFix = true
		}
	case ast.NodeMark:
		if 3 == len(node.Children) && "NodeText" == node.Children[1].TypeStr {
			if strings.HasPrefix(node.Children[1].Data, " ") || strings.HasSuffix(node.Children[1].Data, " ") {
				node.Children[1].Data = strings.TrimSpace(node.Children[1].Data)
				*needFix = true
			}
		}
	case ast.NodeHeading:
		if 6 < node.HeadingLevel {
			node.HeadingLevel = 6
			*needFix = true
		}
	case ast.NodeLinkDest:
		if bytes.HasPrefix(node.Tokens, []byte("assets/")) && bytes.HasSuffix(node.Tokens, []byte(" ")) {
			node.Tokens = bytes.TrimSpace(node.Tokens)
			*needFix = true
		}
	case ast.NodeText:
		if nil != tip.LastChild && ast.NodeTagOpenMarker == tip.LastChild.Type && 1 > len(node.Tokens) {
			node.Tokens = []byte("Untitled")
			*needFix = true
		}
	case ast.NodeTagCloseMarker:
		if nil != tip.LastChild {
			if ast.NodeTagOpenMarker == tip.LastChild.Type {
				tip.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Untitled")})
				*needFix = true
			} else if "" == tip.LastChild.Text() {
				tip.LastChild.Type = ast.NodeText
				tip.LastChild.Tokens = []byte("Untitled")
				*needFix = true
			}
		}
	case ast.NodeBlockRef:
		// 建立索引时无法解析 `v2.2.0-` 版本的块引用 https://github.com/siyuan-note/siyuan/issues/6889
		// 早先的迁移程序有缺陷，漏迁移了块引用节点，这里检测到块引用节点后标识需要迁移
		*needMigrate2Spec1 = true
	case ast.NodeInlineHTML:
		*needFix = true
		node.Type = ast.NodeHTMLBlock
	}

	for _, kv := range node.KramdownIAL {
		if strings.Contains(kv[1], "\n") {
			val := kv[1]
			val = strings.ReplaceAll(val, "\n", editor.IALValEscNewLine)
			node.SetIALAttr(kv[0], val)
			*needFix = true
		}
	}
}
