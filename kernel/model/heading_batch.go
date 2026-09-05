package model

import (
	"github.com/88250/lute/ast"
)

// GetDocHeadingLevelTransaction 按完整文档中的原始标题级别收集目标，不联动子标题。
func GetDocHeadingLevelTransaction(id, notebook string, source, target int) (counts [6]int, title string, transaction *Transaction, err error) {
	FlushTxQueue()
	tree, err := LoadTreeByBlockIDInExactBox(id, notebook)
	if err != nil {
		return
	}
	if tree.Root.ID != id {
		err = ErrTreeNotFound
		return
	}
	title = tree.Root.IALAttr("title")
	headings, counts := collectDocHeadingLevelNodes(tree.Root, source)
	if source < 1 || source > 6 || target < 1 || target > 6 || source == target || len(headings) == 0 {
		return counts, title, nil, nil
	}
	fillBlockRefCount(headings, tree.Box)
	transaction = buildDocHeadingLevelTransaction(headings, target-source, id)
	return
}

func collectDocHeadingLevelNodes(root *ast.Node, source int) (headings []*ast.Node, counts [6]int) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeHeading && node.HeadingLevel >= 1 && node.HeadingLevel <= 6 {
			counts[node.HeadingLevel-1]++
			if node.HeadingLevel == source {
				headings = append(headings, node)
			}
		}
		return ast.WalkContinue
	})
	return
}

func buildDocHeadingLevelTransaction(headings []*ast.Node, diff int, rootID string) *Transaction {
	transaction := buildHeadingLevelTransaction(headings, nil, diff)
	for _, operations := range [][]*Operation{transaction.DoOperations, transaction.UndoOperations} {
		for _, operation := range operations {
			// 完整文档转换保留折叠属性，界面在事务完成后按新层级重新加载。
			operation.Context = map[string]any{"headingBatchRootID": rootID}
		}
	}
	return transaction
}
