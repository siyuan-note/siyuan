// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func collectionSourceVersion(source []byte) string {
	hash := sha256.Sum256(source)
	return hex.EncodeToString(hash[:])
}

func PreviewCollectionRemoval(operations []*Operation, tagChanges []*apicontract.TagRemovalChange) (*apicontract.CollectionRemovalPreview, error) {
	if len(operations) == 0 || len(operations) > 1000 || len(tagChanges) > 1000 {
		return nil, fmt.Errorf("invalid collection removal operations")
	}
	for _, change := range tagChanges {
		if change == nil || !ast.IsNodeIDPattern(change.ID) || len(change.Tags) == 0 || len(change.Tags) > 1000 {
			return nil, fmt.Errorf("invalid collection removal tags")
		}
	}
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	projection, err := newCollectionRemovalProjection(operations)
	if err != nil {
		return nil, err
	}
	defer projection.close()
	groups, err := previewCollectionRemovalTrees(projection.before, projection.after, projection.sources, tagChanges)
	if err != nil {
		return nil, err
	}
	versions := map[string]string{}
	for id, source := range projection.sources {
		versions[id] = collectionSourceVersion(source)
	}
	return &apicontract.CollectionRemovalPreview{Collections: groups, SourceVersions: versions}, nil
}

func collectionBlockReferences(tree *parse.Tree) map[string]map[string]bool {
	refs := map[string]map[string]bool{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeCustomBlock || node.Type == ast.NodeAttributeView {
			return ast.WalkSkipChildren
		}
		if treenode.IsBlockRef(node) {
			if block := treenode.ParentBlock(node); block != nil {
				if refs[block.ID] == nil {
					refs[block.ID] = map[string]bool{}
				}
				id, _, _ := treenode.GetBlockRef(node)
				refs[block.ID][id] = true
			}
		}
		return ast.WalkContinue
	})
	return refs
}

func previewCollectionRemovalTrees(before, after map[string]*parse.Tree, sources map[string][]byte,
	tagChanges []*apicontract.TagRemovalChange) ([]*apicontract.TagRemovalCollection, error) {
	result := []*apicontract.TagRemovalCollection{}
	currentNodes := map[string]*ast.Node{}
	currentRefs := map[string]map[string]bool{}
	for _, tree := range after {
		for id, node := range collectionNodes(tree) {
			currentNodes[id] = node
		}
		for id, refs := range collectionBlockReferences(tree) {
			currentRefs[id] = refs
		}
	}
	removedRefs := map[string]map[string]bool{}
	for _, tree := range before {
		for id, refs := range collectionBlockReferences(tree) {
			if currentNodes[id] == nil {
				continue
			}
			for ref := range refs {
				if !currentRefs[id][ref] {
					if removedRefs[id] == nil {
						removedRefs[id] = map[string]bool{}
					}
					removedRefs[id][ref] = true
				}
			}
		}
	}
	removedTags := map[string][]string{}
	tagSources := map[string]map[string]bool{}
	for rootID, tree := range before {
		for _, change := range tagChanges {
			old, next := treenode.GetNodeInTree(tree, change.ID), currentNodes[change.ID]
			if old == nil || next == nil {
				continue
			}
			for _, tag := range change.Tags {
				filter := &av.AutomationBlockSource{Tags: []string{tag}}
				if collectionTagsMatch(filter, old) && !collectionTagsMatch(filter, next) {
					removedTags[rootID] = append(removedTags[rootID], tag)
					if tagSources[rootID] == nil {
						tagSources[rootID] = map[string]bool{}
					}
					tagSources[rootID][change.ID] = true
				}
			}
		}
	}
	if len(removedRefs) == 0 && len(removedTags) == 0 {
		return result, nil
	}
	versions := map[string]string{}
	for id, source := range sources {
		versions[id] = collectionSourceVersion(source)
	}
	tx := &Transaction{luteEngine: util.NewLute(), trees: after}
	defer tx.finishAttributeViewMutation(false)
	views := map[string]*av.AttributeView{}
	boundaries := map[string]string{}
	for _, tree := range before {
		boundary := ""
		if IsEncryptedBox(tree.Box) {
			boundary = tree.Box
		}
		index, err := av.BlockCollectionIndexInBox(boundary)
		if err != nil {
			return nil, err
		}
		for id := range index.ViewIDsForDocument(tree.Box, tree.ID, tree.Path) {
			if views[id] != nil {
				continue
			}
			view, err := tx.readAttributeViewForMutation(id, "", boundary)
			if err != nil {
				return nil, err
			}
			views[id], boundaries[id] = view, boundary
		}
	}
	beforeResolver, afterResolver := collectionReferenceResolver(before), collectionReferenceResolver(after)
	for id, view := range views {
		review := tx.newCollectionReview(view, boundaries[id])
		if review.uncertain || review.bindingSensitive || len(review.rules) == 0 {
			continue
		}
		was, now := map[string]bool{}, map[string]bool{}
		for _, rule := range review.rules {
			changedSources := map[string]bool{}
			if rule.BlockSource.ReferenceID != "" {
				target := beforeResolver(rule.BlockSource.ReferenceID, boundaries[id])
				for sourceID, refs := range removedRefs {
					for refID := range refs {
						matches := refID == rule.BlockSource.ReferenceID
						if !matches && target != nil && target.Type == "d" {
							definition := beforeResolver(refID, boundaries[id])
							matches = definition != nil && definition.RootID == target.ID
						}
						if matches {
							changedSources[sourceID] = true
						}
					}
				}
			}
			for rootID, tree := range before {
				if len(changedSources) > 0 {
					for blockID := range collectionMatchesWithReferences(rule.BlockSource, tree, beforeResolver, changedSources) {
						was[blockID] = true
					}
				}
				if labels := removedTags[rootID]; len(labels) > 0 && len(rule.BlockSource.Tags) > 0 {
					// 精确移除的当前标签仍可定位逐字改名后的已有自动条目。
					source := *rule.BlockSource
					source.Tags, source.TagMatch = labels, "or"
					for blockID := range collectionMatchesWithReferences(&source, tree, beforeResolver, tagSources[rootID]) {
						was[blockID] = true
					}
				}
			}
			for _, tree := range after {
				for blockID := range collectionMatchesWithReferences(rule.BlockSource, tree, afterResolver, nil) {
					now[blockID] = true
				}
			}
		}
		group := &apicontract.TagRemovalCollection{AvID: id, Name: view.Name,
			Cleanup: apicontract.AVCollectionCleanup{RuleVersion: review.version, AutomaticOnly: true,
				SourceVersions: versions, Items: []*apicontract.AVCollectionCleanupItem{}}}
		for _, row := range view.GetBlockKeyValues().Values {
			if row == nil || row.IsDetached || row.Block == nil || row.Block.CollectionRuleID == "" ||
				currentNodes[row.Block.ID] == nil || !was[row.Block.ID] || now[row.Block.ID] {
				continue
			}
			group.Cleanup.Items = append(group.Cleanup.Items, &apicontract.AVCollectionCleanupItem{ItemID: row.BlockID, BlockID: row.Block.ID})
		}
		if len(group.Cleanup.Items) > 0 {
			result = append(result, group)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].AvID < result[j].AvID })
	return result, nil
}

func (tx *Transaction) prepareCollectionRemovalVersions() error {
	tx.collectionRemovalVersions = nil
	if tx.isReplay {
		return nil
	}
	addVersions := func(versions map[string]string) error {
		if len(versions) == 0 {
			return nil
		}
		if len(versions) > 1000 {
			return fmt.Errorf("too many collection removal source versions")
		}
		if tx.collectionRemovalVersions == nil {
			tx.collectionRemovalVersions = map[string]string{}
		}
		for id, version := range versions {
			decoded, err := hex.DecodeString(version)
			if !ast.IsNodeIDPattern(id) || err != nil || len(decoded) != sha256.Size {
				return fmt.Errorf("invalid collection removal source version")
			}
			if prior, exists := tx.collectionRemovalVersions[id]; exists && prior != version {
				return fmt.Errorf("conflicting collection removal source versions")
			}
			tx.collectionRemovalVersions[id] = version
		}
		if len(tx.collectionRemovalVersions) > 1000 {
			return fmt.Errorf("too many collection removal source versions")
		}
		return nil
	}
	if err := addVersions(tx.CollectionRemovalSourceVersions); err != nil {
		return err
	}
	for _, op := range tx.DoOperations {
		if op == nil || op.Action != "cleanupAttrViewBlocks" {
			continue
		}
		data, err := json.Marshal(op.Data)
		if err != nil {
			return err
		}
		var cleanup apicontract.AVCollectionCleanup
		if err = json.Unmarshal(data, &cleanup); err != nil {
			return err
		}
		if err = addVersions(cleanup.SourceVersions); err != nil {
			return err
		}
	}
	return nil
}

// 删除目标可能已从索引消失而成为空操作，所有确认过的源文档仍须在首个写操作前复查。
func (tx *Transaction) validateCollectionRemovalSources() error {
	for id, version := range tx.collectionRemovalVersions {
		block := treenode.GetBlockTree(id)
		if block == nil {
			for _, boxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if block = treenode.GetBlockTreeInBox(id, boxID); block != nil {
					break
				}
			}
		}
		if block == nil || block.ID != block.RootID || block.Type != "d" {
			return util.ErrFileChanged
		}
		if IsEncryptedBox(block.BoxID) && !tx.sourceLeases[block.BoxID] {
			if err := AcquireEncryptedBoxOperation(block.BoxID); err != nil {
				return err
			}
			if tx.sourceLeases == nil {
				tx.sourceLeases = map[string]bool{}
			}
			tx.sourceLeases[block.BoxID] = true
		}
		_, source, err := tx.readDocumentSource(block.BoxID, block.Path)
		if err != nil {
			return err
		}
		if collectionSourceVersion(source) != version {
			return util.ErrFileChanged
		}
	}
	return nil
}
