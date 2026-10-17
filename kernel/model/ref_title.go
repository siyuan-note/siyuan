package model

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// SearchExactRefDocTitle 在指定索引边界内解析完整文档标题，并读取目标文档后生成块引用。
func SearchExactRefDocTitle(id, rootID, title, boxID string) (blocks []*Block, newDoc bool, err error) {
	blocks = []*Block{}
	title = strings.TrimSpace(title)
	if title == "" {
		return
	}
	targetID, err := sql.QueryExactDocTitleIDInBox(title, id, rootID, boxID)
	if err != nil {
		return nil, false, err
	}
	if targetID == "" {
		return blocks, true, nil
	}
	bt := treenode.GetBlockTreeInExactBox(targetID, boxID)
	if bt == nil {
		return nil, false, fmt.Errorf("document [%s] not found", targetID)
	}
	tree, err := loadTreeByBlockTree(bt)
	if err != nil {
		return nil, false, err
	}
	if tree == nil || !strings.EqualFold(tree.Root.IALAttr("title"), title) {
		return nil, false, fmt.Errorf("document [%s] title index is outdated", targetID)
	}
	block := fromSQLBlock(sql.BuildBlockFromNode(tree.Root, tree), "", 0)
	if block == nil {
		return nil, false, fmt.Errorf("document [%s] index is unavailable", targetID)
	}
	block.RefText = getNodeRefText(tree.Root)
	blocks = append(blocks, block)
	prependNotebookNameInHPath(blocks)
	filterSelfHPath(blocks)
	return
}
