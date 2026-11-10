// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func tagRemovalChanges(request apicontract.TagRemovalPreviewRequest) ([]*apicontract.TagRemovalChange, error) {
	if request.Label != "" {
		if len(request.Changes) != 0 {
			return nil, fmt.Errorf("label and changes are mutually exclusive")
		}
		sql.FlushQueue()
		changes := []*apicontract.TagRemovalChange{}
		seen := map[string]bool{}
		for _, span := range sql.QueryTagSpansByLabel(request.Label) {
			if !seen[span.BlockID] {
				seen[span.BlockID] = true
				changes = append(changes, &apicontract.TagRemovalChange{ID: span.BlockID, Tags: []string{request.Label}})
			}
		}
		return changes, nil
	}
	if len(request.Changes) == 0 || len(request.Changes) > 1000 {
		return nil, fmt.Errorf("invalid tag removal changes")
	}
	return request.Changes, nil
}

// 使用独立的已认证源快照推演标签删除，不修改缓存或持久化数据。
func tagRemovalTrees(changes []*apicontract.TagRemovalChange) (before, after map[string]*parse.Tree, sources map[string][]byte, err error) {
	before, after = map[string]*parse.Tree{}, map[string]*parse.Tree{}
	sources = map[string][]byte{}
	for _, change := range changes {
		if change == nil || !ast.IsNodeIDPattern(change.ID) || len(change.Tags) == 0 || len(change.Tags) > 1000 {
			return nil, nil, nil, fmt.Errorf("invalid tag removal change")
		}
		bt := treenode.GetBlockTree(change.ID)
		if bt == nil {
			continue
		}
		// 标签属于普通工作区；不扫描或暴露加密笔记本的内容。
		if IsEncryptedBox(bt.BoxID) {
			return nil, nil, nil, fmt.Errorf("tags are unavailable in encrypted notebooks")
		}
		if before[bt.RootID] == nil {
			before[bt.RootID], sources[bt.RootID], err = filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, util.NewLute())
			if err != nil {
				return nil, nil, nil, err
			}
			var projectedSource []byte
			after[bt.RootID], projectedSource, err = filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, util.NewLute())
			if err != nil {
				return nil, nil, nil, err
			}
			if !bytes.Equal(sources[bt.RootID], projectedSource) {
				return nil, nil, nil, util.ErrFileChanged
			}
		}
		node := treenode.GetNodeInTree(after[bt.RootID], change.ID)
		if node == nil {
			continue
		}
		if err = removeNodeTags(node, change.Tags); err != nil {
			return nil, nil, nil, err
		}
	}
	return
}

func removeNodeTags(node *ast.Node, labels []string) error {
	if node.Type == ast.NodeDocument {
		tags := strings.Split(node.IALAttr("tags"), ",")
		tags = slices.DeleteFunc(tags, func(tag string) bool { return slices.Contains(labels, tag) })
		node.SetIALAttr("tags", strings.Join(tags, ","))
		return nil
	}
	finishRich, err := treenode.MaterializeTableCellRich(node)
	if err != nil {
		return err
	}
	finishTitles := treenode.MaterializeInlineTitles(node)
	var removed []*ast.Node
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != node && n.IsBlock() && n.ID != "" {
			return ast.WalkSkipChildren
		}
		if (n.Type == ast.NodeTag || n.Type == ast.NodeTextMark && n.IsTextMarkType("tag")) && slices.Contains(labels, n.Content()) {
			removed = append(removed, n)
		}
		return ast.WalkContinue
	})
	for _, tag := range removed {
		tag.Unlink()
	}
	finishTitles()
	return finishRich()
}

func PreviewTagRemoval(request apicontract.TagRemovalPreviewRequest) ([]*apicontract.TagRemovalCollection, error) {
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	changes, err := tagRemovalChanges(request)
	if err != nil {
		return nil, err
	}
	before, after, _, err := tagRemovalTrees(changes)
	if err != nil {
		return nil, err
	}
	return previewTagRemovalTrees(before, after, changes)
}

func previewTagRemovalTrees(before, after map[string]*parse.Tree, changes []*apicontract.TagRemovalChange) ([]*apicontract.TagRemovalCollection, error) {
	if len(before) == 0 {
		return []*apicontract.TagRemovalCollection{}, nil
	}
	index, err := av.BlockCollectionIndexInBox("")
	if err != nil {
		return nil, err
	}
	ret := []*apicontract.TagRemovalCollection{}
	views := map[string]*av.AttributeView{}
	for _, tree := range before {
		for id := range index.ViewIDsForDocument(tree.Box, tree.ID, tree.Path) {
			if views[id] != nil {
				continue
			}
			view, readErr := av.ParseAttributeViewForIndexInBox(id, "")
			if readErr != nil {
				return nil, readErr
			}
			views[id] = view
		}
	}
	tx := &Transaction{luteEngine: util.NewLute(), trees: map[string]*parse.Tree{}}
	defer tx.finishAttributeViewMutation(false)
	for _, view := range views {
		review := tx.newCollectionReview(view, "")
		if review.uncertain || review.bindingSensitive || len(review.rules) == 0 {
			continue
		}
		group := &apicontract.TagRemovalCollection{AvID: view.ID, Name: view.Name,
			Cleanup: apicontract.AVCollectionCleanup{RuleVersion: review.version, AutomaticOnly: true, Items: []*apicontract.AVCollectionCleanupItem{}}}
		for rootID, oldTree := range before {
			was, now := map[string]bool{}, map[string]bool{}
			var removedLabels []string
			for _, change := range changes {
				if treenode.GetNodeInTree(oldTree, change.ID) != nil {
					removedLabels = append(removedLabels, change.Tags...)
				}
			}
			for _, rule := range review.rules {
				for id := range collectionMatches(rule.BlockSource, oldTree) {
					was[id] = true
				}
				for id := range collectionMatches(rule.BlockSource, after[rootID]) {
					now[id] = true
				}
				// 逐字退格会先改名；以本次实际移除的标签定位原有自动条目的收集对象。
				if len(rule.BlockSource.Tags) > 0 && len(removedLabels) > 0 {
					source := *rule.BlockSource
					source.Tags, source.TagMatch = removedLabels, "or"
					remaining := collectionMatches(&source, after[rootID])
					for id := range collectionMatches(&source, oldTree) {
						if !remaining[id] {
							was[id] = true
						}
					}
				}
			}
			for _, row := range view.GetBlockKeyValues().Values {
				if row == nil || row.IsDetached || row.Block == nil || row.Block.CollectionRuleID == "" || !was[row.Block.ID] || now[row.Block.ID] {
					continue
				}
				group.Cleanup.Items = append(group.Cleanup.Items, &apicontract.AVCollectionCleanupItem{ItemID: row.BlockID, BlockID: row.Block.ID})
			}
		}
		if len(group.Cleanup.Items) > 0 {
			ret = append(ret, group)
		}
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].AvID < ret[j].AvID })
	return ret, nil
}

// 全局标签删除使用普通编辑事务，源标签和用户选择移出的字段共用撤销记录。
func RemoveTagWithCollections(request apicontract.RemoveTagWithCollectionsRequest) (*Transaction, error) {
	if request.Label == "" {
		return nil, fmt.Errorf("tag must not be empty")
	}
	type result struct {
		tx  *Transaction
		err error
	}
	ret := WithTransactionHistory(func(execute func(*Transaction) error) result {
		changes, err := tagRemovalChanges(apicontract.TagRemovalPreviewRequest{Label: request.Label})
		if err != nil {
			return result{err: err}
		}
		before, after, sources, err := tagRemovalTrees(changes)
		if err != nil {
			return result{err: err}
		}
		eligible, err := previewTagRemovalTrees(before, after, changes)
		if err != nil {
			return result{err: err}
		}
		allowed := map[string]map[string]bool{}
		for _, group := range eligible {
			allowed[group.AvID] = map[string]bool{}
			for _, item := range group.Cleanup.Items {
				allowed[group.AvID][item.ItemID+"/"+item.BlockID] = true
			}
		}
		tx := &Transaction{fromAPI: true, Timestamp: time.Now().UnixMilli(), tagRemovalSources: sources}
		engine := util.NewLute()
		changed := map[string]bool{}
		for _, change := range changes {
			changed[change.ID] = true
		}
		for rootID, tree := range after {
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !changed[node.ID] {
					return ast.WalkContinue
				}
				old := treenode.GetNodeInTree(before[rootID], node.ID)
				if node.Type == ast.NodeDocument {
					if node.IALAttr("tags") == old.IALAttr("tags") {
						return ast.WalkContinue
					}
					data, _ := json.Marshal(map[string]string{"tags": node.IALAttr("tags")})
					undo, _ := json.Marshal(map[string]string{"tags": old.IALAttr("tags")})
					tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs", ID: node.ID, Data: string(data)})
					tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "setAttrs", ID: node.ID, Data: string(undo)})
					return ast.WalkContinue
				}
				data, undo := engine.RenderNodeBlockDOM(node), engine.RenderNodeBlockDOM(old)
				if data == undo {
					return ast.WalkContinue
				}
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "update", ID: node.ID, Data: data})
				tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "update", ID: node.ID, Data: undo})
				return ast.WalkSkipChildren
			})
		}
		for _, group := range request.Collections {
			if group == nil {
				return result{err: fmt.Errorf("invalid tag removal collection")}
			}
			group.Cleanup.AutomaticOnly = true
			group.Cleanup.Items = slices.DeleteFunc(slices.Clone(group.Cleanup.Items), func(item *apicontract.AVCollectionCleanupItem) bool {
				return item == nil || !allowed[group.AvID][item.ItemID+"/"+item.BlockID]
			})
			for offset := 0; offset < len(group.Cleanup.Items); offset += 100 {
				cleanup := group.Cleanup
				cleanup.Items = cleanup.Items[offset:min(offset+100, len(cleanup.Items))]
				op := &Operation{Action: "cleanupAttrViewBlocks", AvID: group.AvID, Data: cleanup}
				tx.DoOperations = append(tx.DoOperations, op)
				tx.UndoOperations = append(tx.UndoOperations, op)
			}
		}
		if len(tx.DoOperations) == 0 {
			return result{tx: tx}
		}
		if err = execute(tx); err != nil {
			return result{err: err}
		}
		return result{tx: tx}
	})
	return ret.tx, ret.err
}
