// SiYuan - Build Your Eternal Digital Garden
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

package model

import (
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// Block 描述了内容块。
type Block struct {
	Box      string            `json:"box"`
	Path     string            `json:"path"`
	HPath    string            `json:"hPath"`
	ID       string            `json:"id"`
	RootID   string            `json:"rootID"`
	ParentID string            `json:"parentID"`
	Name     string            `json:"name"`
	Alias    string            `json:"alias"`
	Memo     string            `json:"memo"`
	Tag      string            `json:"tag"`
	Content  string            `json:"content"`
	FContent string            `json:"fcontent"`
	Markdown string            `json:"markdown"`
	Folded   bool              `json:"folded"`
	Type     string            `json:"type"`
	SubType  string            `json:"subType"`
	RefText  string            `json:"refText"`
	Defs     []*Block          `json:"-"`    // 当前块引用了这些块，避免序列化 JSON 时产生循环引用
	Refs     []*Block          `json:"refs"` // 当前块被这些块引用
	DefID    string            `json:"defID"`
	DefPath  string            `json:"defPath"`
	IAL      map[string]string `json:"ial"`
	Children []*Block          `json:"children"`
	Depth    int               `json:"depth"`
	Count    int               `json:"count"`
}

func (block *Block) IsContainerBlock() bool {
	switch block.Type {
	case "NodeDocument", "NodeBlockquote", "NodeList", "NodeListItem", "NodeSuperBlock":
		return true
	}
	return false
}

type Path struct {
	ID       string   `json:"id"`       // 块 ID
	Box      string   `json:"box"`      // 块 Box
	Name     string   `json:"name"`     // 当前路径
	Type     string   `json:"type"`     // "path"
	NodeType string   `json:"nodeType"` // 节点类型
	SubType  string   `json:"subType"`  // 节点子类型
	Blocks   []*Block `json:"blocks"`   // 子块节点
	Children []*Path  `json:"children"` // 子路径节点
	Depth    int      `json:"depth"`    // 层级深度
	Count    int      `json:"count"`    // 子块计数
}

func RecentUpdatedBlocks() (ret []*Block) {
	ret = []*Block{}

	sqlBlocks := sql.QueryRecentUpdatedBlocks()
	if 1 > len(sqlBlocks) {
		return
	}

	ret = fromSQLBlocks(&sqlBlocks, "", 0)
	return
}

func GetBlockDOM(id string) (ret string) {
	if "" == id {
		return
	}

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	luteEngine := NewLute()
	ret = lute.RenderNodeBlockDOM(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	return
}

func GetBlockKramdown(id string) (ret string) {
	if "" == id {
		return
	}

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	addBlockIALNodes(tree, false)
	node := treenode.GetNodeInTree(tree, id)
	luteEngine := NewLute()
	ret, _ = lute.FormatNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	return
}

func GetBlock(id string) (ret *Block, err error) {
	ret, err = getBlock(id)
	return
}

func getBlock(id string) (ret *Block, err error) {
	if "" == id {
		return
	}

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	sqlBlock := sql.BuildBlockFromNode(node, tree)
	if nil == sqlBlock {
		return
	}
	ret = fromSQLBlock(sqlBlock, "", 0)
	return
}

func getBlockRendered(id string, headingMode int) (ret *Block) {
	tree, _ := loadTreeByBlockID(id)
	if nil == tree {
		return
	}
	def := treenode.GetNodeInTree(tree, id)
	if nil == def {
		return
	}

	var unlinks, nodes []*ast.Node
	ast.Walk(def, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type {
			if "1" == n.IALAttr("fold") {
				children := treenode.HeadingChildren(n)
				for _, c := range children {
					unlinks = append(unlinks, c)
				}
			}
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	nodes = append(nodes, def)
	if 0 == headingMode && ast.NodeHeading == def.Type && "1" != def.IALAttr("fold") {
		children := treenode.HeadingChildren(def)
		for _, c := range children {
			if "1" == c.IALAttr("heading-fold") {
				// 嵌入块包含折叠标题时不应该显示其下方块 https://github.com/siyuan-note/siyuan/issues/4765
				continue
			}
			nodes = append(nodes, c)
		}
	}

	b := treenode.GetBlockTree(def.ID)
	if nil == b {
		return
	}

	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = false // 不可编辑
	dom := renderBlockDOMByNodes(nodes, luteEngine)
	ret = &Block{Box: def.Box, Path: def.Path, HPath: b.HPath, ID: def.ID, Type: def.Type.String(), Content: dom}
	return
}
