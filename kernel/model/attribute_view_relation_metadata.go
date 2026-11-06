// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"slices"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func relationMetadataCarrier(context *AttributeViewRelationContext, blockID string, allowBound ...bool) (*av.AttributeView, error) {
	if context == nil || blockID == "" {
		return nil, errors.New("database metadata requires a real carrier")
	}
	if err := context.ResolveStorage(blockID); err != nil {
		return nil, err
	}
	source, err := av.ParseAttributeViewWithStorageContext(context.SourceAvID, context.storageBoxID)
	if err != nil {
		return nil, err
	}
	tree, err := LoadTreeByBlockIDInExactBox(blockID, context.storageBoxID)
	if err != nil {
		return nil, err
	}
	node := treenode.GetNodeInTree(tree, blockID)
	bound := false
	if len(allowBound) > 0 && allowBound[0] {
		value := source.GetBlockValueByBoundID(blockID)
		bound = value != nil && !value.IsDetached
	}
	if node == nil || !(node.Type == ast.NodeAttributeView && node.AttributeViewID == source.ID || bound) {
		return nil, errors.New("database metadata carrier does not match")
	}
	return source, nil
}

func resolveAttributeViewRelationDependency(targetID, blockID string, context *AttributeViewRelationContext, keyIDs []string) (*av.AttributeView, error) {
	if len(keyIDs) < 1 || len(keyIDs) > 2 {
		return nil, errors.New("relation dependency requires one or two relation fields")
	}
	scope, err := resolveAttributeViewRelationScope(context, blockID, "", true)
	if err != nil {
		return nil, err
	}
	target := scope.target
	for _, keyID := range keyIDs {
		key, keyErr := target.GetKey(keyID)
		if keyErr != nil || key.Type != av.KeyTypeRelation || key.Relation == nil {
			return nil, av.ErrKeyNotFound
		}
		target, err = av.ParseAttributeViewWithStorageContext(key.Relation.AvID, scope.boxID)
		if err != nil {
			return nil, err
		}
	}
	if target.ID != targetID {
		return nil, errors.New("relation dependency target does not match")
	}
	return target, nil
}

func GetAttributeViewRelationDependencyMetadata(targetID, blockID string, context *AttributeViewRelationContext, keyIDs []string) (*AttributeViewData, error) {
	waitForSyncingStorages()
	target, err := resolveAttributeViewRelationDependency(targetID, blockID, context, keyIDs)
	if err != nil {
		return nil, err
	}
	ret := &AttributeViewData{ID: target.ID, Name: target.Name, Spec: target.Spec, KeyValues: []*av.KeyValues{}}
	for _, kv := range target.KeyValues {
		ret.KeyValues = append(ret.KeyValues, &av.KeyValues{Key: kv.Key, Values: []*av.Value{}})
	}
	return ret, nil
}

func GetAttributeViewRelationDependencyPrimaryValues(targetID, blockID string, context *AttributeViewRelationContext, keyIDs []string,
	keyword string, itemIDs []string, page, pageSize int) (name string, carriers []string, values *av.KeyValues, total int, err error) {
	waitForSyncingStorages()
	target, err := resolveAttributeViewRelationDependency(targetID, blockID, context, keyIDs)
	if err != nil {
		return
	}
	target, err = cloneAttributeViewForFieldMutation(target)
	if err != nil {
		return
	}
	name = getAttrViewName(target)
	carriers, err = attributeViewRelationCarrierIDs(target)
	if err != nil {
		return
	}
	values = target.GetBlockKeyValues()
	if values == nil {
		values = &av.KeyValues{}
		return
	}
	boxID, _ := target.StorageContext()
	byID := map[string]*av.Value{}
	selected := []*av.Value{}
	for _, value := range values.Values {
		if value == nil || value.Block == nil || !value.IsDetached && treenode.GetBlockTreeInExactBox(value.Block.ID, boxID) == nil {
			continue
		}
		byID[value.BlockID] = value
		if strings.Contains(strings.ToLower(value.String(true)), strings.ToLower(keyword)) {
			selected = append(selected, value)
		}
	}
	if len(itemIDs) > 0 {
		values.Values = []*av.Value{}
		for _, id := range itemIDs {
			if value := byID[id]; value != nil {
				values.Values = append(values.Values, value)
			}
		}
		total = len(values.Values)
		return
	}
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].Block.Updated == selected[j].Block.Updated {
			return selected[i].BlockID > selected[j].BlockID
		}
		return selected[i].Block.Updated > selected[j].Block.Updated
	})
	total = len(selected)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 16
	}
	// 先限制页号，避免超大请求的乘法溢出形成负下标。
	start := total
	if page-1 <= total/pageSize {
		start = (page - 1) * pageSize
	}
	values.Values = selected[start : start+min(pageSize, total-start)]
	return
}

// 字段配置没有来源条目，使用真实来源载体与字段目标校验，不放宽条目读取的成员检查。
func GetAttributeViewRelationFieldMetadata(targetID, blockID string, context *AttributeViewRelationContext) (*AttributeViewData, error) {
	waitForSyncingStorages()
	source, err := relationMetadataCarrier(context, blockID, true)
	if err != nil {
		return nil, err
	}
	key, err := source.GetKey(context.RelationKeyID)
	if err != nil || key.Type != av.KeyTypeRelation || key.Relation == nil || key.Relation.AvID != targetID {
		return nil, errors.New("database metadata relation target does not match")
	}
	target, err := av.ParseAttributeViewWithStorageContext(key.Relation.AvID, context.storageBoxID)
	if err != nil {
		return nil, err
	}
	ret := &AttributeViewData{ID: target.ID, Name: target.Name, Spec: target.Spec, Views: []*av.View{}}
	if view, _ := target.GetFirstView(); view != nil {
		ret.ViewID = view.ID
	}
	for _, view := range target.Views {
		if view != nil {
			ret.Views = append(ret.Views, &av.View{ID: view.ID, Name: view.Name, Icon: view.Icon, Desc: view.Desc, LayoutType: view.LayoutType})
		}
	}
	return ret, nil
}

func GetAttributeViewByCarrier(blockID string, context *AttributeViewRelationContext) (*AttributeViewData, error) {
	waitForSyncingStorages()
	target, err := relationMetadataCarrier(context, blockID)
	if err != nil {
		return nil, err
	}
	return NewAttributeViewData(target), nil
}

func GetAttributeViewBacklinksByCarrier(itemID, valueID, blockID string, context *AttributeViewRelationContext) (*AttributeViewBacklinks, error) {
	waitForSyncingStorages()
	target, err := relationMetadataCarrier(context, blockID)
	if err != nil {
		return nil, err
	}
	itemID = resolveAttributeViewBacklinkItemID(target, itemID, valueID)
	if itemID == "" {
		return nil, av.ErrItemNotFound
	}
	return getAttributeViewBacklinksForTargets([]*attributeViewBacklinkTarget{{avID: target.ID, itemID: itemID}}, target)
}

// related 区分来源关系授权和原生详情的真实目标载体授权；两者均不接受客户端指定笔记本。
func GetAttributeViewItemKeysWithContext(avID, itemID, valueID, blockID string, context *AttributeViewRelationContext, related bool, executions ...*templatehttp.Execution) ([]*BlockAttributeViewKeys, error) {
	waitForSyncingStorages()
	var target *av.AttributeView
	var members []string
	var err error
	if related {
		scope, scopeErr := resolveAttributeViewRelationScope(context, blockID, avID, true)
		if scopeErr != nil {
			return nil, scopeErr
		}
		target, members = scope.target, scope.itemIDs
	} else {
		if context == nil || context.SourceAvID != avID {
			return nil, errors.New("database metadata target does not match")
		}
		target, err = relationMetadataCarrier(context, blockID)
		if err != nil {
			return nil, err
		}
	}
	if target.GetBlockValue(itemID) == nil && valueID != "" {
		if primary := target.GetBlockKeyValues(); primary != nil {
			for _, value := range primary.Values {
				if value.ID == valueID {
					itemID = value.BlockID
					break
				}
			}
		}
	}
	if target.GetBlockValue(itemID) == nil || related && !slices.Contains(members, itemID) {
		return nil, av.ErrItemNotFound
	}
	target, err = cloneAttributeViewForFieldMutation(target)
	if err != nil {
		return nil, err
	}
	view, err := getRenderAttributeViewView(target, "", "", "", false)
	if err != nil {
		return nil, err
	}
	renderContext := attributeViewItemHTTPContext(executions)
	renderContext.ReadOnly = true
	collection, ok := sql.RenderViewItemWithContext(target, view, itemID, renderContext).(av.Collection)
	if !ok {
		return nil, av.ErrViewNotFound
	}
	values := getAttributeViewItemKeyValues(target, collection, itemID, false)
	refreshAttrViewKeyIDs(target, false)
	order := map[string]int{}
	for i, id := range target.KeyIDs {
		order[id] = i
	}
	sort.SliceStable(values, func(i, j int) bool { return order[values[i].Key.ID] < order[values[j].Key.ID] })
	carriers, err := attributeViewRelationCarrierIDs(target)
	if err != nil {
		return nil, err
	}
	boxID, _ := target.StorageContext()
	notebookID := boxID
	if len(carriers) > 0 {
		carrier := treenode.GetBlockTreeInExactBox(carriers[0], boxID)
		if carrier == nil {
			return nil, ErrBlockNotFound
		}
		notebookID = carrier.BoxID
	} else if primary := target.GetBlockValue(itemID); !primary.IsDetached && primary.Block != nil {
		tree, loadErr := LoadTreeByBlockIDInExactBox(primary.Block.ID, boxID)
		if loadErr != nil {
			return nil, loadErr
		}
		notebookID = tree.Box
	}
	return []*BlockAttributeViewKeys{{AvID: target.ID, AvName: getAttrViewName(target), NotebookID: notebookID,
		BlockIDs: carriers, CustomColors: target.Palette(), KeyValues: values, ItemPositions: getAttributeViewItemPositions(target, itemID)}}, nil
}
