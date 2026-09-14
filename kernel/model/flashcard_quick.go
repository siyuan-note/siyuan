package model

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// emptyQuickFlashcardBlocks 从源文档识别纯空白段落，同一文档只读取一次。
func emptyQuickFlashcardBlocks(blockIDs []string) (map[string]bool, error) {
	empty := map[string]bool{}
	trees := map[string]*parse.Tree{}
	for _, blockID := range blockIDs {
		bt := treenode.GetBlockTreeInExactBox(blockID, "")
		if bt == nil {
			return nil, fmt.Errorf("flashcard block [%s] not found", blockID)
		}
		tree := trees[bt.RootID]
		if tree == nil {
			var err error
			tree, err = LoadTreeByBlockIDInExactBox(blockID, "")
			if err != nil {
				return nil, err
			}
			if tree == nil {
				return nil, fmt.Errorf("flashcard document for block [%s] not found", blockID)
			}
			trees[bt.RootID] = tree
		}
		node := treenode.GetNodeInTree(tree, blockID)
		if node == nil {
			return nil, fmt.Errorf("flashcard block [%s] not found in document", blockID)
		}
		if isEmptyQuickFlashcardParagraph(node) {
			empty[blockID] = true
		}
	}
	return empty, nil
}

// isEmptyQuickFlashcardParagraph 仅忽略空白文字和换行，保留具有独立语义的行内节点。
func isEmptyQuickFlashcardParagraph(node *ast.Node) bool {
	if node == nil || node.Type != ast.NodeParagraph {
		return false
	}
	for child := node.FirstChild; child != nil; child = child.Next {
		switch child.Type {
		case ast.NodeText:
			if strings.TrimSpace(strings.ReplaceAll(string(child.Tokens), "\u200b", "")) != "" {
				return false
			}
		case ast.NodeSoftBreak, ast.NodeHardBreak, ast.NodeBr, ast.NodeKramdownSpanIAL:
		case ast.NodeTextMark:
			for _, mark := range strings.Fields(child.TextMarkType) {
				switch mark {
				case "strong", "em", "s", "u", "mark", "sup", "sub", "text":
				default:
					return false
				}
			}
			if strings.TrimSpace(strings.ReplaceAll(child.TextMarkTextContent, "\u200b", "")) != "" {
				return false
			}
		default:
			return false
		}
	}
	return true
}
