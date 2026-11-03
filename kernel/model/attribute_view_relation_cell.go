// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"slices"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

type AttributeViewRelationCellContext struct {
	RelationContext AttributeViewRelationContext
	SourceItemIDs   []string
}

func resolveAttributeViewRelationCellScope(avID, keyID, blockID string, context *AttributeViewRelationCellContext) (*attributeViewRelationScope, error) {
	if context == nil || len(context.SourceItemIDs) == 0 || len(context.SourceItemIDs) > 10000 {
		return nil, errors.New("invalid relation cell context")
	}
	root, err := resolveAttributeViewRelationScope(&context.RelationContext, blockID, avID, true)
	if err != nil {
		return nil, err
	}
	members := make(map[string]bool, len(root.itemIDs))
	for _, id := range root.itemIDs {
		members[id] = true
	}
	seen := map[string]bool{}
	for _, id := range context.SourceItemIDs {
		if !ast.IsNodeIDPattern(id) || seen[id] || !members[id] || root.target.GetBlockValue(id) == nil {
			return nil, errors.New("relation cell source is outside the current detail members")
		}
		seen[id] = true
	}
	key, err := root.target.GetKey(keyID)
	if err != nil || key.Type != av.KeyTypeRelation || key.Relation == nil {
		return nil, av.ErrKeyNotFound
	}
	target, err := av.ParseAttributeViewWithStorageContext(key.Relation.AvID, root.boxID)
	if err != nil {
		return nil, err
	}
	return &attributeViewRelationScope{source: root.target, target: target, key: key, boxID: root.boxID}, nil
}

func (tx *Transaction) resolveRelationChangeScope(op *Operation, context *AttributeViewRelationContext, targetID string, requireEnabled bool) (*attributeViewRelationScope, error) {
	blockID := op.BlockID
	if cells := op.relationCellContext; cells != nil {
		root, err := tx.resolveRelationCellReplayScope(op, &cells.RelationContext, op.AvID, cells.SourceItemIDs)
		if err != nil {
			return nil, err
		}
		if context == nil || context.SourceAvID != op.AvID || context.SourceItemID != op.RowID ||
			context.RelationKeyID != op.KeyID || !slices.Contains(cells.SourceItemIDs, op.RowID) {
			return nil, errors.New("relation cell operation does not match context")
		}
		if context.storageKnown && context.storageBoxID != root.boxID {
			return nil, errors.New("relation cell operation changed storage context")
		}
		context.storageBoxID, context.storageKnown = root.boxID, true
		// 根载体只验证根授权；内部字段从已验证目标表解析，不能把根块伪装成其来源行或载体。
		blockID, requireEnabled = "", false
	}
	return resolveAttributeViewRelationScope(context, blockID, targetID, requireEnabled)
}

func validateRelationCellCreationCells(context *AttributeViewRelationCellContext, cells []*AttributeViewRelationItemCell) error {
	if context == nil || len(cells) != len(context.SourceItemIDs) {
		return errors.New("relation cell creation sources do not match context")
	}
	seen := map[string]bool{}
	for _, cell := range cells {
		if cell == nil || seen[cell.ItemID] || !slices.Contains(context.SourceItemIDs, cell.ItemID) {
			return errors.New("relation cell creation sources do not match context")
		}
		seen[cell.ItemID] = true
	}
	return nil
}

func validateRelationCellNewItemSource(source *av.AttributeView, keyID string, context *AttributeViewRelationCellContext) error {
	if context != nil && len(context.SourceItemIDs) > 1 && source.HasSubItems() && source.SubItems.ChildrenKeyID == keyID {
		return errors.New("a new database sub-item cannot have multiple parents")
	}
	return nil
}

func GetAttributeViewRelationCellCandidates(avID, keyID, blockID, keyword string, selectedIDs []string, page, pageSize int,
	candidateSort *av.ViewSort, excludes []string, context *AttributeViewRelationCellContext) (
	name string, carriers []string, colors []*av.AttributeViewCustomColor, columns []*av.TableColumn,
	selected, rows []*av.TableRow, total int, err error) {
	return getAttributeViewRelationCandidatesWithContext(avID, keyID, keyword, selectedIDs, page, pageSize, candidateSort,
		excludes, nil, context, blockID)
}

func PreviewAttributeViewRelationCellItem(avID, blockID, keyID, keyword string, context *AttributeViewRelationCellContext) *AttributeViewRelationItemPreview {
	return previewAttributeViewRelationItem(avID, blockID, keyID, keyword, nil, context)
}

func CreateAttributeViewRelationCellItem(avID, blockID, keyID, keyword string, cells []*AttributeViewRelationItemCell,
	preview *AttributeViewRelationItemPreview, useInputName bool, context *AttributeViewRelationCellContext, selections ...*DocumentSelection) (*CreateAttributeViewItemResult, error) {
	if err := validateRelationCellCreationCells(context, cells); err != nil {
		return nil, err
	}
	return createAttributeViewRelationItem(avID, blockID, keyID, keyword, cells, preview, useInputName, nil, context, selections...)
}
