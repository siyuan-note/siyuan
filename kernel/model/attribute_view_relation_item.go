package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

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

func attributeViewRelationItemTarget(avID, blockID, keyID string) (source, target *av.AttributeView, targetBlockID string, err error) {
	source, err = avParseView(avID, blockID)
	if err != nil {
		return
	}
	key, _ := source.GetKey(keyID)
	if key == nil || key.Type != av.KeyTypeRelation || key.Relation == nil || key.Relation.AvID == "" {
		err = av.ErrKeyNotFound
		return
	}
	_, sourceBoxID := av.FindAttributeViewPath(avID)
	target, err = av.ParseAttributeViewInBox(key.Relation.AvID, sourceBoxID)
	if err != nil {
		return
	}
	_, targetBoxID := av.FindAttributeViewPath(target.ID)
	if !IsSameCryptoBoundary(sourceBoxID, targetBoxID) {
		err = errors.New(Conf.Language(381))
		return
	}
	for _, id := range treenode.GetMirrorAttrViewBlockIDs(target.ID) {
		node, tree, loadErr := getNodeByBlockID(nil, id)
		if loadErr == nil && node != nil && node.AttributeViewID == target.ID && IsSameCryptoBoundary(sourceBoxID, tree.Box) {
			targetBlockID = id
			return
		}
	}
	err = ErrBlockNotFound
	return
}

// PreviewAttributeViewRelationItem 仅解析目标数据库的默认模板，解析失败不阻断已有条目的选择。
func PreviewAttributeViewRelationItem(avID, blockID, keyID, keyword string) *AttributeViewRelationItemPreview {
	ret := &AttributeViewRelationItemPreview{CreatedAt: time.Now().UnixMilli()}
	_, target, targetBlockID, err := attributeViewRelationItemTarget(avID, blockID, keyID)
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
			preview, err = resolveAttributeViewNewItemTemplateWithFallback(targetBlockID, itemTemplate,
				time.UnixMilli(ret.CreatedAt), keyword)
			if err == nil {
				ret.PrimaryKey = preview.PrimaryKey
				ret.InputPrimaryKey = strings.TrimSpace(keyword)
				if av.NewItemTargetDocument == itemTemplate.TargetType && "" != ret.InputPrimaryKey {
					preview, err = resolveAttributeViewItemDocument(targetBlockID, ret.InputPrimaryKey, itemTemplate,
						time.UnixMilli(ret.CreatedAt))
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

// CreateAttributeViewRelationItem 将模板创建、来源单元格更新和双向关联放入同一个可撤销事务。
func CreateAttributeViewRelationItem(avID, blockID, keyID, keyword string, cells []*AttributeViewRelationItemCell,
	preview *AttributeViewRelationItemPreview, useInputName bool) (*CreateAttributeViewItemResult, error) {
	if preview == nil || preview.Error != "" || len(cells) == 0 {
		return nil, errors.New("invalid relation item creation request")
	}
	createdAt := time.UnixMilli(preview.CreatedAt)
	if age := time.Since(createdAt); age < -time.Second || age > 5*time.Minute {
		return nil, errors.New("new item template preview expired")
	}
	source, target, targetBlockID, err := attributeViewRelationItemTarget(avID, blockID, keyID)
	if err != nil {
		return nil, err
	}
	if target.DefaultTemplateID != preview.TemplateID {
		return nil, errors.New("new item template preview changed")
	}
	sourceTree, err := LoadTreeByBlockID(blockID)
	if err != nil {
		return nil, err
	}
	if err = validateAttributeViewBinding(source.ID, sourceTree); err != nil {
		return nil, err
	}
	sourceNode := treenode.GetNodeInTree(sourceTree, blockID)
	if sourceNode == nil {
		return nil, ErrBlockNotFound
	}
	seen := map[string]bool{}
	var oldValues []*av.Value
	for _, cell := range cells {
		if cell == nil || source.GetBlockValue(cell.ItemID) == nil || seen[cell.ItemID] {
			return nil, av.ErrItemNotFound
		}
		seen[cell.ItemID] = true
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
				value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{
					BlockIDs: append(slices.Clone(cell.RelatedItemIDs), itemID),
				}}
				do = append(do, &Operation{Action: "updateAttrViewCell", AvID: avID, BlockID: blockID,
					KeyID: keyID, RowID: cell.ItemID, Data: value})
				undo = append(undo, &Operation{Action: "updateAttrViewCell", AvID: avID, BlockID: blockID,
					KeyID: keyID, RowID: cell.ItemID, Data: oldValues[i]})
			}
			do = append(do, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
			undo = append(undo, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: sourceNode.IALAttr("updated")})
			return
		},
	}
	if useInputName {
		primary := strings.TrimSpace(keyword)
		if "" == primary {
			return nil, errors.New("relation item input name is empty")
		}
		options.primaryOverride = &primary
	}
	return createAttributeViewItem(target.ID, targetBlockID, "", preview.TemplateID, "", "", nil, options)
}
