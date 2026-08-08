// SiYuan - From thought to insight, with agents
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
	"errors"
	"fmt"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// BlockUpdateInput 描述一个外部块更新请求。
type BlockUpdateInput struct {
	ID       string
	Data     string
	DataType string
	LockType bool
}

type blockUpdateTreeKey struct {
	boxID  string
	rootID string
}

type blockUpdateTreeResolver func(id string) *treenode.BlockTree
type blockUpdateTreeLoader func(id string) (*parse.Tree, error)
type blockUpdateOperationsBuilder func(inputs []BlockUpdateInput) ([]*Operation, []string, error)

// BuildBlockUpdateOperations 解析并校验所有块更新，全部通过后返回可执行的事务操作。
func BuildBlockUpdateOperations(inputs []BlockUpdateInput) (operations []*Operation, rootIDs []string, err error) {
	return buildBlockUpdateOperations(inputs, treenode.GetBlockTree, LoadTreeByBlockID)
}

// PerformBlockUpdates 在事务串行区内准备并同步执行外部块更新。
func PerformBlockUpdates(inputs []BlockUpdateInput) (transactions []*Transaction, rootIDs []string, err error) {
	return performBlockUpdates(inputs, BuildBlockUpdateOperations)
}

func performBlockUpdates(inputs []BlockUpdateInput, build blockUpdateOperationsBuilder) (transactions []*Transaction, rootIDs []string, err error) {
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()

	// 先执行已入队事务，保证本次校验基于调用前已经提交的修改。
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}

	operations, rootIDs, err := build(inputs)
	if err != nil {
		return nil, nil, err
	}

	transaction := &Transaction{DoOperations: operations}
	if err = performTxSyncLocked(transaction); err != nil {
		return nil, nil, err
	}
	return []*Transaction{transaction}, rootIDs, nil
}

func buildBlockUpdateOperations(inputs []BlockUpdateInput, resolveTree blockUpdateTreeResolver, loadTree blockUpdateTreeLoader) (operations []*Operation, rootIDs []string, err error) {
	if 1 > len(inputs) {
		return nil, nil, errors.New("block updates are empty")
	}

	luteEngine := util.NewLute()
	rootIDSet := map[string]struct{}{}
	treeCache := map[blockUpdateTreeKey]*parse.Tree{}
	for _, input := range inputs {
		if !ast.IsNodeIDPattern(input.ID) {
			return nil, nil, fmt.Errorf("invalid block ID [%s]", input.ID)
		}

		data, dataTree, parseErr := parseBlockUpdateData(input.Data, input.DataType, luteEngine)
		if parseErr != nil {
			return nil, nil, parseErr
		}

		var oldTree *parse.Tree
		var cacheKey blockUpdateTreeKey
		hasCacheKey := false
		if blockTree := resolveTree(input.ID); nil != blockTree {
			cacheKey = blockUpdateTreeKey{boxID: blockTree.BoxID, rootID: blockTree.RootID}
			hasCacheKey = true
			oldTree = treeCache[cacheKey]
		}
		if nil == oldTree {
			var loadErr error
			oldTree, loadErr = loadTree(input.ID)
			if loadErr != nil {
				return nil, nil, fmt.Errorf("load block tree [%s] failed: %w", input.ID, loadErr)
			}
			if nil == oldTree || nil == oldTree.Root {
				return nil, nil, fmt.Errorf("load block tree [%s] failed: tree is empty", input.ID)
			}
			treeCache[blockUpdateTreeKey{boxID: oldTree.Box, rootID: oldTree.ID}] = oldTree
			if hasCacheKey {
				treeCache[cacheKey] = oldTree
			}
		}
		oldNode := treenode.GetNodeInTree(oldTree, input.ID)
		if nil == oldNode {
			return nil, nil, fmt.Errorf("block [%s] not found", input.ID)
		}

		if _, ok := rootIDSet[oldTree.ID]; !ok {
			rootIDSet[oldTree.ID] = struct{}{}
			rootIDs = append(rootIDs, oldTree.ID)
		}

		if ast.NodeDocument == oldNode.Type {
			if validateErr := treenode.ValidateBlockSubtree(dataTree.Root); validateErr != nil {
				return nil, nil, validateErr
			}
			for n := oldTree.Root.FirstChild; nil != n; n = n.Next {
				if !n.IsBlock() || ast.NodeKramdownBlockIAL == n.Type {
					continue
				}
				operations = append(operations, &Operation{Action: "delete", ID: n.ID, Data: map[string]any{
					"createEmptyParagraph": false, // 清空文档后前端不要创建空段落
				}})
			}
			operations = append(operations, &Operation{Action: "appendInsert", Data: data, ParentID: input.ID})
			continue
		}

		normalizedTree, updatedNode, normalizeErr := normalizeBlockUpdateTree(oldNode, dataTree, luteEngine)
		if normalizeErr != nil {
			return nil, nil, normalizeErr
		}
		if validateErr := treenode.ValidateBlockReplacement(oldNode, updatedNode); validateErr != nil {
			return nil, nil, validateErr
		}
		if typeErr := validateBlockUpdateType(oldNode, updatedNode, input.LockType); typeErr != nil {
			return nil, nil, typeErr
		}

		updatedNode.SetIALAttr("id", input.ID)
		pinDescendantBlockIDs(oldNode, updatedNode)
		data = luteEngine.Tree2BlockDOM(normalizedTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		operations = append(operations, &Operation{
			Action:   "update",
			ID:       input.ID,
			Data:     data,
			LockType: input.LockType,
		})
	}
	return
}

// DataBlockDOM 将 Markdown 转换为块 DOM，并校验输入中显式指定的块 ID。
func DataBlockDOM(data string, luteEngine *lute.Lute) (ret string, err error) {
	luteEngine.SetHTMLTag2TextMark(true) // API 无法使用 HTML 标签插入或更新行内元素 https://github.com/siyuan-note/siyuan/issues/6039

	ret, tree := luteEngine.Md2BlockDOMTree(data, true)
	if "" == ret {
		// 使用 API 插入空字符串出现错误 https://github.com/siyuan-note/siyuan/issues/3931
		blankParagraph := treenode.NewParagraph("")
		ret = luteEngine.RenderNodeBlockDOM(blankParagraph)
	}

	invalidID := ""
	if nil != tree && nil != tree.Root {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if "" != n.ID && !ast.IsNodeIDPattern(n.ID) {
				invalidID = n.ID
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
	}
	if "" != invalidID {
		return "", errors.New("found invalid ID [" + invalidID + "]")
	}
	return
}

func parseBlockUpdateData(data, dataType string, luteEngine *lute.Lute) (ret string, tree *parse.Tree, err error) {
	ret = data
	switch dataType {
	case "markdown":
		ret, err = DataBlockDOM(data, luteEngine)
		if err != nil {
			err = fmt.Errorf("data block DOM failed: %w", err)
			return
		}
	case "dom":
	default:
		err = fmt.Errorf("unsupported block data type [%s]", dataType)
		return
	}

	tree = luteEngine.BlockDOM2Tree(ret)
	if nil == tree || nil == tree.Root || nil == firstContentBlock(tree.Root) {
		err = errors.New("parse tree failed")
	}
	return
}

func normalizeBlockUpdateTree(oldNode *ast.Node, tree *parse.Tree, luteEngine *lute.Lute) (ret *parse.Tree, updatedNode *ast.Node, err error) {
	updatedNode, err = resolveBlockUpdateNode(oldNode, tree.Root)
	if err != nil {
		return nil, nil, err
	}

	updatedNode.Unlink()
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(updatedNode)
	ret = &parse.Tree{
		Root:    root,
		Context: &parse.Context{ParseOption: luteEngine.ParseOptions},
	}
	return
}

func resolveBlockUpdateNode(oldNode, root *ast.Node) (updatedNode *ast.Node, err error) {
	updatedNode = firstContentBlock(root)
	if nil == updatedNode {
		return nil, errors.New("parse tree failed")
	}
	if ast.NodeListItem == oldNode.Type && ast.NodeList == updatedNode.Type {
		listItem := firstContentBlock(updatedNode)
		if nil == listItem || ast.NodeListItem != listItem.Type {
			return nil, errors.New("list block has no list item")
		}
		updatedNode = listItem
	}
	return
}

// pinDescendantBlockIDs 把旧块子树中对应位置的子块 ID 钉回新块，避免更新容器块时 Lute 重新生成
// 子块 ID，导致指向子块的块引用、反链、闪卡等失效。
// 匹配规则：按同级内容块顺序对齐，类型一致才沿用旧 ID；类型不一致时向后查找同类型的旧子块重新
// 对齐，这样插入或删除子块后其余子块仍能匹配上旧 ID，新增的子块保持新生成的 ID。
func pinDescendantBlockIDs(oldNode, updatedNode *ast.Node) {
	oldChildren := blockChildrenOf(oldNode)
	oldIndex := 0
	for _, newChild := range blockChildrenOf(updatedNode) {
		if oldIndex >= len(oldChildren) {
			break
		}
		if oldChildren[oldIndex].Type != newChild.Type {
			if aligned := alignBlockUpdateChild(oldChildren, oldIndex, newChild.Type); 0 > aligned {
				continue
			} else {
				oldIndex = aligned
			}
		}
		newChild.SetIALAttr("id", oldChildren[oldIndex].ID)
		pinDescendantBlockIDs(oldChildren[oldIndex], newChild)
		oldIndex++
	}
}

// alignBlockUpdateChild 从 start 起向后查找第一个指定类型的旧子块，返回其下标；找不到返回 -1。
func alignBlockUpdateChild(oldChildren []*ast.Node, start int, childType ast.NodeType) int {
	for i := start; i < len(oldChildren); i++ {
		if oldChildren[i].Type == childType {
			return i
		}
	}
	return -1
}

// blockChildrenOf 返回节点的直接内容块子节点，不含行级块 IAL。
func blockChildrenOf(parent *ast.Node) (ret []*ast.Node) {
	for child := parent.FirstChild; nil != child; child = child.Next {
		if child.IsBlock() && ast.NodeKramdownBlockIAL != child.Type {
			ret = append(ret, child)
		}
	}
	return
}

func firstContentBlock(parent *ast.Node) *ast.Node {
	if nil == parent {
		return nil
	}
	for child := parent.FirstChild; nil != child; child = child.Next {
		if child.IsBlock() && ast.NodeKramdownBlockIAL != child.Type {
			return child
		}
	}
	return nil
}

func validateBlockUpdateType(oldNode, updatedNode *ast.Node, lockType bool) error {
	if !lockType || oldNode.Type == updatedNode.Type || isEmptyParagraphBlock(oldNode) {
		return nil
	}
	return fmt.Errorf("block [%s] type is locked: expected %s, got %s",
		oldNode.ID, oldNode.Type.String(), updatedNode.Type.String())
}

func isEmptyParagraphBlock(node *ast.Node) bool {
	if nil == node || ast.NodeParagraph != node.Type {
		return false
	}
	for child := node.FirstChild; nil != child; child = child.Next {
		switch child.Type {
		case ast.NodeText:
			text := strings.ReplaceAll(string(child.Tokens), "\u200b", "")
			if "" != strings.TrimSpace(text) {
				return false
			}
		case ast.NodeSoftBreak, ast.NodeBr:
		default:
			return false
		}
	}
	return true
}
