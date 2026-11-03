// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeViewRelationItemPreview 固定本次模板解析时间，供关联面板预览并确认新条目名称。
type AttributeViewRelationItemPreview struct {
	HasPrimaryKeyTemplate bool
	InputPrimaryKey       string
	TemplateID            string
	PrimaryKey            string
	CreatedAt             int64
	Error                 string
}

// AttributeViewRelationItemCell 保留前端批量编辑合并后的已有关系，新条目在事务内追加。
type AttributeViewRelationItemCell struct {
	ItemID         string
	RelatedItemIDs []string
}

func attributeViewRelationItemTarget(avID, blockID, keyID string, contexts ...*AttributeViewRelationContext) (source, target *av.AttributeView, targetBlockID string, err error) {
	var context *AttributeViewRelationContext
	if len(contexts) > 0 {
		context = contexts[0]
	}
	return attributeViewRelationItemTargetWithScope(avID, blockID, keyID, context, nil)
}

func attributeViewRelationItemTargetWithScope(avID, blockID, keyID string, context *AttributeViewRelationContext, cellContext *AttributeViewRelationCellContext) (source, target *av.AttributeView, targetBlockID string, err error) {
	if cellContext != nil {
		var scope *attributeViewRelationScope
		scope, err = resolveAttributeViewRelationCellScope(avID, keyID, blockID, cellContext)
		if err != nil {
			return
		}
		source, target = scope.source, scope.target
	} else if context != nil {
		var scope *attributeViewRelationScope
		scope, err = resolveAttributeViewRelationScope(context, blockID, "", true)
		if err != nil {
			return
		}
		source, target = scope.source, scope.target
	} else {
		source, err = avParseView(avID, blockID)
		if err != nil {
			return
		}
	}
	key, _ := source.GetKey(keyID)
	if key == nil || key.Type != av.KeyTypeRelation || key.Relation == nil || key.Relation.AvID == "" {
		err = av.ErrKeyNotFound
		return
	}
	_, sourceBoxID := source.StoragePath()
	if target == nil {
		if _, scoped := source.StorageContext(); scoped {
			target, err = av.ParseAttributeViewWithStorageContext(key.Relation.AvID, sourceBoxID)
		} else {
			target, err = av.ParseAttributeViewInBox(key.Relation.AvID, sourceBoxID)
		}
		if err != nil {
			return
		}
	}
	_, targetBoxID := target.StoragePath()
	if !IsSameCryptoBoundary(sourceBoxID, targetBoxID) {
		err = errors.New(Conf.Language(381))
		return
	}
	var carrierIDs []string
	carrierIDs, err = attributeViewRelationCarrierIDs(target)
	if err != nil {
		return
	}
	for _, id := range carrierIDs {
		if _, scoped := target.StorageContext(); scoped {
			targetBlockID = id
			return
		}
		node, tree, loadErr := getNodeByBlockID(nil, id)
		if loadErr == nil && node != nil && node.AttributeViewID == target.ID && IsSameCryptoBoundary(sourceBoxID, tree.Box) {
			targetBlockID = id
			return
		}
	}
	return
}

// PreviewAttributeViewRelationItem 仅解析目标数据库的默认模板，解析失败不阻断已有条目的选择。
func PreviewAttributeViewRelationItem(avID, blockID, keyID, keyword string, contexts ...*AttributeViewRelationContext) *AttributeViewRelationItemPreview {
	var context *AttributeViewRelationContext
	if len(contexts) > 0 {
		context = contexts[0]
	}
	return previewAttributeViewRelationItem(avID, blockID, keyID, keyword, context, nil)
}

func previewAttributeViewRelationItem(avID, blockID, keyID, keyword string, context *AttributeViewRelationContext, cellContext *AttributeViewRelationCellContext) *AttributeViewRelationItemPreview {
	ret := &AttributeViewRelationItemPreview{CreatedAt: time.Now().UnixMilli()}
	source, target, targetBlockID, err := attributeViewRelationItemTargetWithScope(avID, blockID, keyID, context, cellContext)
	if err == nil {
		err = validateRelationCellNewItemSource(source, keyID, cellContext)
	}
	if err == nil {
		ret.TemplateID = target.DefaultTemplateID
		itemTemplate := target.GetNewItemTemplate(ret.TemplateID)
		if ret.TemplateID != "" && itemTemplate == nil {
			err = fmt.Errorf("new item template [%s] not found", ret.TemplateID)
		} else {
			if itemTemplate == nil {
				itemTemplate = &av.NewItemTemplate{TargetType: av.NewItemTargetDetached}
			}
			ret.HasPrimaryKeyTemplate = "" != strings.TrimSpace(itemTemplate.PrimaryKeyTemplate)
			var preview *NewItemTemplatePreview
			_, targetBoxID := target.StoragePath()
			preview, err = resolveAttributeViewNewItemTemplateWithDocumentContext(targetBlockID, targetBoxID, itemTemplate,
				time.UnixMilli(ret.CreatedAt), keyword, context != nil || cellContext != nil)
			var ambiguity *DocumentAncestorAmbiguity
			if errors.As(err, &ambiguity) {
				err = nil
			}
			if err == nil {
				ret.PrimaryKey = preview.PrimaryKey
				ret.InputPrimaryKey = strings.TrimSpace(keyword)
				if av.NewItemTargetDocument == itemTemplate.TargetType && "" != ret.InputPrimaryKey {
					preview, err = resolveAttributeViewItemDocumentInStorage(targetBlockID, targetBoxID, context != nil || cellContext != nil, ret.InputPrimaryKey, itemTemplate,
						time.UnixMilli(ret.CreatedAt))
					if errors.As(err, &ambiguity) {
						err = nil
					}
					if err == nil {
						ret.InputPrimaryKey = preview.PrimaryKey
					}
				}
			}
		}
	}
	if err != nil {
		ret.Error = err.Error()
	}
	return ret
}

// 文档沿用原生计划创建，数据库条目、来源单元格和双向关联通过同一可撤销事务写入。
func CreateAttributeViewRelationItem(avID, blockID, keyID, keyword string, cells []*AttributeViewRelationItemCell,
	preview *AttributeViewRelationItemPreview, useInputName bool, selections ...*DocumentSelection) (*CreateAttributeViewItemResult, error) {
	return createAttributeViewRelationItem(avID, blockID, keyID, keyword, cells, preview, useInputName, nil, nil, selections...)
}

func CreateAttributeViewRelationDetailItem(avID, blockID, keyID, keyword string, cells []*AttributeViewRelationItemCell,
	preview *AttributeViewRelationItemPreview, useInputName bool, context *AttributeViewRelationContext, selections ...*DocumentSelection) (*CreateAttributeViewItemResult, error) {
	if context == nil || context.SourceAvID != avID || context.RelationKeyID != keyID || len(cells) != 1 || cells[0] == nil || cells[0].ItemID != context.SourceItemID {
		return nil, errors.New("invalid relation detail creation context")
	}
	if _, err := resolveAttributeViewRelationScope(context, blockID, "", true); err != nil {
		return nil, err
	}
	return createAttributeViewRelationItem(avID, blockID, keyID, keyword, cells, preview, useInputName, context, nil, selections...)
}

func createAttributeViewRelationItem(avID, blockID, keyID, keyword string, cells []*AttributeViewRelationItemCell,
	preview *AttributeViewRelationItemPreview, useInputName bool, context *AttributeViewRelationContext, cellContext *AttributeViewRelationCellContext, selections ...*DocumentSelection) (*CreateAttributeViewItemResult, error) {
	if preview == nil || preview.Error != "" || len(cells) == 0 {
		return nil, errors.New("invalid relation item creation request")
	}
	createdAt := time.UnixMilli(preview.CreatedAt)
	if age := time.Since(createdAt); age < -time.Second || age > 5*time.Minute {
		return nil, errors.New("new item template preview expired")
	}
	source, target, targetBlockID, err := attributeViewRelationItemTargetWithScope(avID, blockID, keyID, context, cellContext)
	if err != nil {
		return nil, err
	}
	if err = validateRelationCellNewItemSource(source, keyID, cellContext); err != nil {
		return nil, err
	}
	if target.DefaultTemplateID != preview.TemplateID {
		return nil, errors.New("new item template preview changed")
	}
	sourceUpdated := ""
	if blockID != "" {
		var sourceTree *parse.Tree
		var loadErr error
		if boxID, scoped := source.StorageContext(); scoped {
			sourceTree, loadErr = LoadTreeByBlockIDInExactBox(blockID, boxID)
		} else {
			sourceTree, loadErr = LoadTreeByBlockID(blockID)
		}
		if loadErr != nil {
			return nil, loadErr
		}
		if cellContext == nil {
			if boxID, scoped := source.StorageContext(); scoped {
				err = validateAttributeViewBindingInStorage(source.ID, boxID, sourceTree)
			} else {
				err = validateAttributeViewBinding(source.ID, sourceTree)
			}
			if err != nil {
				return nil, err
			}
		}
		// 表内单元格的根块已经过根关系验证，此处只记录该面板的撤销上下文，不作为新建目标载体。
		sourceNode := treenode.GetNodeInTree(sourceTree, blockID)
		if sourceNode == nil {
			return nil, ErrBlockNotFound
		}
		sourceUpdated = sourceNode.IALAttr("updated")
	}
	seen := map[string]bool{}
	var oldValues []*av.Value
	for _, cell := range cells {
		if cell == nil || source.GetBlockValue(cell.ItemID) == nil || seen[cell.ItemID] {
			return nil, av.ErrItemNotFound
		}
		seen[cell.ItemID] = true
		if context != nil || cellContext != nil {
			continue
		}
		for _, id := range cell.RelatedItemIDs {
			if target.GetBlockValue(id) == nil {
				return nil, av.ErrItemNotFound
			}
		}
		oldValue := source.GetValue(keyID, cell.ItemID)
		if oldValue == nil {
			oldValue = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{}}}
		}
		oldValues = append(oldValues, oldValue.Clone())
	}
	options := &attributeViewItemCreationOptions{
		templateTime: createdAt, primaryFallback: keyword, expectedPrimary: preview.PrimaryKey,
		operations: func(itemID string) (do, undo []*Operation) {
			for i, cell := range cells {
				if context != nil || cellContext != nil {
					changeContext := context
					operationCellContext := cellContext
					if cellContext != nil {
						boxID, _ := source.StorageContext()
						changeContext = &AttributeViewRelationContext{SourceAvID: avID, SourceItemID: cell.ItemID,
							RelationKeyID: keyID, storageBoxID: boxID, storageKnown: true}
						// 全批来源在事务准备阶段验证；执行时只核本行，避免前一行的合法换父使后一行失效。
						operationCellContext = &AttributeViewRelationCellContext{RelationContext: cellContext.RelationContext,
							SourceItemIDs: []string{cell.ItemID}}
					}
					do = append(do, &Operation{Action: "updateAttrViewRelationItems", AvID: avID, BlockID: blockID,
						relationDetailContext: changeContext, relationCellContext: operationCellContext, KeyID: keyID, RowID: cell.ItemID, Data: AttributeViewRelationItemsChange{AddItemIDs: []string{itemID}, RemoveItemIDs: []string{}}})
					undo = append(undo, &Operation{Action: "updateAttrViewRelationItems", AvID: avID, BlockID: blockID,
						relationDetailContext: changeContext, relationCellContext: operationCellContext, KeyID: keyID, RowID: cell.ItemID, Data: AttributeViewRelationItemsChange{AddItemIDs: []string{}, RemoveItemIDs: []string{itemID}}})
					continue
				}
				value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{
					BlockIDs: append(slices.Clone(cell.RelatedItemIDs), itemID),
				}}
				do = append(do, &Operation{Action: "updateAttrViewCell", AvID: avID, BlockID: blockID,
					KeyID: keyID, RowID: cell.ItemID, Data: value})
				undo = append(undo, &Operation{Action: "updateAttrViewCell", AvID: avID, BlockID: blockID,
					KeyID: keyID, RowID: cell.ItemID, Data: oldValues[i]})
			}
			if blockID != "" {
				do = append(do, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
				undo = append(undo, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: sourceUpdated})
			}
			return
		},
	}
	if context != nil || cellContext != nil {
		options.storageBoxID, options.storageKnown = target.StorageContext()
	}
	if useInputName {
		primary := strings.TrimSpace(keyword)
		if "" == primary {
			return nil, errors.New("relation item input name is empty")
		}
		options.primaryOverride = &primary
	}
	var selection *DocumentSelection
	if len(selections) > 0 {
		selection = selections[0]
	}
	return createAttributeViewItem(target.ID, targetBlockID, "", preview.TemplateID, "", "", nil, options, selection)
}
