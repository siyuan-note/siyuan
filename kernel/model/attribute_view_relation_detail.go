// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"slices"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type AttributeViewRelationContext struct {
	SourceAvID    string `json:"sourceAvID"`
	SourceItemID  string `json:"sourceItemID"`
	RelationKeyID string `json:"relationKeyID"`
	storageBoxID  string
	storageKnown  bool
}

func (context *AttributeViewRelationContext) ResolveStorage(blockID string) error {
	if context == nil || !ast.IsNodeIDPattern(context.SourceAvID) {
		return ErrInvalidID
	}
	boxID, exact, err := resolveAttributeViewCarrierBoxID(blockID)
	if err != nil {
		return err
	}
	if context.storageKnown {
		if exact && boxID != context.storageBoxID {
			return errors.New("relation detail source changed encryption boundary")
		}
		return nil
	}
	if !exact {
		_, boxID = av.FindAttributeViewPath(context.SourceAvID)
	}
	context.storageBoxID, context.storageKnown = boxID, true
	return nil
}

func (context *AttributeViewRelationContext) StorageContext() (string, bool) {
	if context == nil {
		return "", false
	}
	return context.storageBoxID, context.storageKnown
}

type AttributeViewRelationItemsChange struct {
	AddItemIDs    []string `json:"addItemIDs"`
	RemoveItemIDs []string `json:"removeItemIDs"`
}

// 未导出快照只由已提交事务的撤销日志持有，不从客户端操作 JSON 恢复。
type attributeViewRelationDetailSnapshot struct {
	context                        AttributeViewRelationContext
	keyID, targetID, before, after string
	retargetID                     string
}

type attributeViewRelationScope struct {
	source, target *av.AttributeView
	key            *av.Key
	itemIDs        []string
	boxID          string
}

func (tx *Transaction) strictAttributeViewRelationWrite(avID string) bool {
	if tx == nil {
		return false
	}
	_, scoped := tx.attributeViewStorageContexts[avID]
	return scoped
}

// ResolveRelationDetailStorage 固定当前请求的真实来源边界，供 API 在解析数据库前取得相同笔记本租约。
func (op *Operation) ResolveRelationDetailStorage() (boxID string, scoped bool, err error) {
	context := op.RelationContext
	if context == nil {
		context = op.relationDetailContext
	}
	if context == nil && (op.Action == "updateAttrViewRelationItems" || op.Action == "setAttrViewRelationDetail") {
		context = &AttributeViewRelationContext{SourceAvID: op.AvID, SourceItemID: op.RowID, RelationKeyID: op.KeyID}
	}
	if context == nil {
		return "", false, nil
	}
	if err = context.ResolveStorage(op.BlockID); err != nil {
		return "", true, err
	}
	op.relationDetailContext = context
	boxID, _ = context.StorageContext()
	return boxID, true, nil
}

func (tx *Transaction) prepareRelationDetailOperations() error {
	for _, op := range tx.DoOperations {
		context := op.RelationContext
		targetID := ""
		if op.Action == "updateAttrViewRelationItems" {
			context = op.relationDetailContext
			if state := op.attributeViewRelationSubItems; state != nil {
				var err error
				if context, err = state.operationContext(op); err != nil {
					return err
				}
				targetID = context.SourceAvID
			}
			if context == nil {
				context = &AttributeViewRelationContext{SourceAvID: op.AvID, SourceItemID: op.RowID, RelationKeyID: op.KeyID}
			}
		}
		if context == nil {
			continue
		}
		scope, err := tx.resolveRelationChangeScope(op, context, targetID, op.RelationContext != nil)
		if err != nil {
			return err
		}
		if state := op.attributeViewRelationSubItems; state != nil {
			if err = state.validateScope(scope); err != nil {
				return err
			}
		}
		op.relationDetailContext = context
		for _, undo := range tx.UndoOperations {
			if undo.Action == op.Action && undo.AvID == op.AvID && undo.RowID == op.RowID && undo.KeyID == op.KeyID {
				undo.relationDetailContext = context
			}
		}
		if tx.attributeViewStorageContexts == nil {
			tx.attributeViewStorageContexts = map[string]string{}
		}
		for _, database := range []*av.AttributeView{scope.source, scope.target} {
			if previous, exists := tx.attributeViewStorageContexts[database.ID]; exists && previous != scope.boxID {
				return errors.New("ambiguous database storage context in transaction")
			}
			tx.attributeViewStorageContexts[database.ID] = scope.boxID
		}
		tx.attributeViewItemCreation = true
		if err = tx.rememberAutomationView(scope.source, op.BlockID); err != nil {
			return err
		}
		if err = tx.rememberAutomationView(scope.target, op.BlockID); err != nil {
			return err
		}
		// 在创建目标条目或写入双向边之前记录全部来源，支持中断恢复。
		if err = tx.prepareRelationSourceJournal(&Operation{AvID: scope.source.ID, ID: scope.target.ID, KeyID: context.RelationKeyID}); err != nil {
			return err
		}
	}
	return nil
}

func resolveAttributeViewRelationScope(context *AttributeViewRelationContext, blockID, targetID string, requireEnabled bool) (*attributeViewRelationScope, error) {
	if context == nil || !ast.IsNodeIDPattern(context.SourceAvID) || !ast.IsNodeIDPattern(context.SourceItemID) || !ast.IsNodeIDPattern(context.RelationKeyID) {
		return nil, errors.New("invalid database relation context")
	}
	if err := context.ResolveStorage(blockID); err != nil {
		return nil, err
	}
	source, err := av.ParseAttributeViewWithStorageContext(context.SourceAvID, context.storageBoxID)
	if err != nil {
		return nil, err
	}
	if source == nil {
		return nil, av.ErrViewNotFound
	}
	item := source.GetBlockValue(context.SourceItemID)
	if item == nil || item.Block == nil {
		return nil, av.ErrItemNotFound
	}
	if blockID != "" {
		tree, loadErr := LoadTreeByBlockIDInExactBox(blockID, context.storageBoxID)
		if loadErr != nil {
			return nil, loadErr
		}
		node := treenode.GetNodeInTree(tree, blockID)
		if node == nil || !(node.Type == ast.NodeAttributeView && node.AttributeViewID == source.ID || !item.IsDetached && item.Block.ID == node.ID) {
			return nil, errors.New("database relation source carrier does not match")
		}
	}
	key, err := source.GetKey(context.RelationKeyID)
	if err != nil || key.Type != av.KeyTypeRelation || key.Relation == nil || key.Relation.AvID == "" {
		return nil, av.ErrKeyNotFound
	}
	if requireEnabled {
		if err = key.Relation.DetailView.Validate(); err != nil {
			return nil, err
		}
		if key.Relation.DetailView == nil || !key.Relation.DetailView.Enabled {
			return nil, errors.New("database relation detail view is disabled")
		}
	}
	if targetID != "" && key.Relation.AvID != targetID {
		return nil, errors.New("database relation target does not match")
	}
	boxID := context.storageBoxID
	target, err := av.ParseAttributeViewWithStorageContext(key.Relation.AvID, boxID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, av.ErrViewNotFound
	}
	ret := &attributeViewRelationScope{source: source, target: target, key: key, boxID: boxID, itemIDs: []string{}}
	if value := source.GetValue(key.ID, context.SourceItemID); value != nil && value.Relation != nil {
		ret.itemIDs = append(ret.itemIDs, value.Relation.BlockIDs...)
	}
	return ret, nil
}

func renderAttributeViewRelationDetail(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]any,
	ignoreRows bool, targetItemID, targetGroupID string, options AttributeViewRenderOptions) (av.Viewable, *av.AttributeView, *AttributeViewRenderTarget, error) {
	scope, err := resolveAttributeViewRelationScope(options.RelationContext, blockID, avID, true)
	if err != nil {
		return nil, nil, nil, err
	}
	scope.target, err = cloneAttributeViewForFieldMutation(scope.target)
	if err != nil {
		return nil, nil, nil, err
	}
	view, err := scope.target.ResolveRelationDetailView(scope.key.Relation.DetailView)
	if err != nil {
		return nil, nil, nil, err
	}
	if viewID != "" {
		view = scope.target.GetView(viewID)
	}
	if view == nil || view.LayoutType != av.LayoutTypeTable || view.Table == nil || view.Table.BaseLayout == nil || options.Nested != nil {
		return nil, nil, nil, errors.New("database relation detail requires a flat table view")
	}
	if options.TemporarySort != nil {
		sort := *options.TemporarySort
		key, keyErr := scope.target.GetKey(sort.Column)
		if keyErr != nil || !av.GetKeyCapability(key.Type).Sortable || sort.Order != av.SortOrderAsc && sort.Order != av.SortOrderDesc {
			return nil, nil, nil, errors.New("invalid relation detail sort")
		}
		view.Sorts = []*av.ViewSort{&sort}
	}
	if err = validateRelationDetailFilters(scope.target, options.TemporaryFilters); err != nil {
		return nil, nil, nil, err
	}
	if len(options.TemporaryFilters) > 0 {
		view.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: append(av.CloneFilters(view.Filters), av.CloneFilters(options.TemporaryFilters)...)}}
		if err = av.ValidateFilterDepth(view.Filters); err != nil {
			return nil, nil, nil, err
		}
	}
	// 在物化行、分组、统计和定位之前限定集合，保留完整数据库供关联及汇总依赖读取。
	requested := make(map[string]bool, len(scope.itemIDs))
	for _, id := range scope.itemIDs {
		requested[id] = true
	}
	allowed := make(map[string]bool, len(scope.itemIDs))
	if primary := scope.target.GetBlockKeyValues(); primary != nil {
		for _, value := range primary.Values {
			if value != nil && requested[value.BlockID] {
				allowed[value.BlockID] = true
			}
		}
	}
	view.GroupItemIDs = []string{}
	seen := map[string]bool{}
	for _, id := range append(slices.Clone(view.ItemIDs), scope.itemIDs...) {
		if allowed[id] && !seen[id] {
			view.GroupItemIDs = append(view.GroupItemIDs, id)
			seen[id] = true
		}
	}
	for _, group := range view.Groups {
		group.GroupItemIDs = slices.DeleteFunc(slices.Clone(group.GroupItemIDs), func(id string) bool { return !allowed[id] })
	}
	view.SubItemsDisplay = "flat"
	scope.target.RenderedViewables = map[string]av.Viewable{}
	var target *AttributeViewRenderTarget
	if targetItemID != "" {
		target = &AttributeViewRenderTarget{ItemID: targetItemID, Status: "itemNotFound"}
		if allowed[targetItemID] {
			target.Status = "filtered"
		}
	}
	viewable, err := renderAttributeViewWithOptions(scope.target, "", view.ID, "", query, page, pageSize, groupPaging,
		ignoreRows, false, target, targetGroupID, options)
	return viewable, scope.target, target, err
}

func validateRelationDetailFilters(target *av.AttributeView, filters []*av.ViewFilter) error {
	if err := av.ValidateFilterDepth(filters); err != nil {
		return err
	}
	for _, filter := range filters {
		if filter == nil {
			return errors.New("invalid relation detail filter")
		}
		if filter.IsGroup() {
			if filter.Combination != av.FilterCombinationAnd && filter.Combination != av.FilterCombinationOr {
				return errors.New("invalid relation detail filter combination")
			}
			if err := validateRelationDetailFilters(target, filter.Filters); err != nil {
				return err
			}
			continue
		}
		key, err := target.GetKey(filter.Column)
		if err != nil || !av.GetKeyCapability(key.Type).Filterable {
			return errors.New("relation detail filter field is unavailable")
		}
		typ := key.Type
		if filter.ValueSource == av.ValueSourceRendered {
			typ = av.KeyTypeText
		} else if filter.ValueSource != "" && filter.ValueSource != av.ValueSourceStored {
			return errors.New("invalid relation detail filter value source")
		}
		if !av.IsFilterOperatorAllowed(typ, filter.Operator) {
			return errors.New("invalid relation detail filter operator")
		}
		if filter.Qualifier != "" && filter.Qualifier != av.FilterQuantifierAny && filter.Qualifier != av.FilterQuantifierAll && filter.Qualifier != av.FilterQuantifierNone {
			return errors.New("invalid relation detail filter quantifier")
		}
		if filter.DateEndpoint != "" && filter.DateEndpoint != av.DateEndpointStart && filter.DateEndpoint != av.DateEndpointEnd {
			return errors.New("invalid relation detail filter date endpoint")
		}
		if filter.Value == nil && filter.Operator != av.FilterOperatorIsEmpty && filter.Operator != av.FilterOperatorIsNotEmpty && filter.Operator != av.FilterOperatorIsTrue && filter.Operator != av.FilterOperatorIsFalse {
			return errors.New("relation detail filter value is missing")
		}
	}
	return nil
}

func (tx *Transaction) doSetAttrViewRelationDetail(op *Operation) *TxErr {
	err := tx.setAttrViewRelationDetail(op)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()}
	}
	return nil
}

func (tx *Transaction) setAttrViewRelationDetail(op *Operation) error {
	context := op.relationDetailContext
	state := op.relationDetailConfig
	if state != nil {
		if !tx.isReplay || op.AvID != state.context.SourceAvID || op.KeyID != state.keyID {
			return errors.New("relation detail configuration replay does not match")
		}
		copy := state.context
		context = &copy
	}
	if context == nil {
		context = &AttributeViewRelationContext{SourceAvID: op.AvID}
	}
	if err := context.ResolveStorage(op.BlockID); err != nil {
		return err
	}
	source, err := av.ParseAttributeViewWithStorageContext(op.AvID, context.storageBoxID)
	if err != nil {
		return err
	}
	if source == nil {
		return av.ErrViewNotFound
	}
	key, err := source.GetKey(op.KeyID)
	if err != nil || key.Type != av.KeyTypeRelation || key.Relation == nil {
		return av.ErrKeyNotFound
	}
	if err = key.Relation.DetailView.Validate(); err != nil {
		return err
	}
	before, err := json.Marshal(key.Relation.DetailView)
	if err != nil {
		return err
	}
	data, err := json.Marshal(op.Data)
	if err != nil {
		return err
	}
	if state != nil {
		expected, desired := state.before, state.after
		if op.relationDetailConfigUndo {
			expected, desired = state.after, state.before
		}
		if key.Relation.AvID != state.targetID || string(before) != expected {
			return errors.New("relation detail configuration changed after edit")
		}
		data = []byte(desired)
	}
	var config *av.RelationDetailView
	if err = json.Unmarshal(data, &config); err != nil {
		return err
	}
	if config != nil {
		if err = config.Validate(); err != nil {
			return err
		}
		if config.Enabled && !(state != nil && op.relationDetailConfigUndo) {
			target, targetErr := av.ParseAttributeViewWithStorageContext(key.Relation.AvID, context.storageBoxID)
			if targetErr != nil {
				return targetErr
			}
			if target == nil {
				return av.ErrViewNotFound
			}
			view := target.GetView(config.ViewID)
			if view == nil || view.LayoutType != av.LayoutTypeTable {
				return errors.New("relation detail configuration requires an existing table")
			}
		}
	}
	tx.attributeViewItemCreation = true
	if tx.attributeViewStorageContexts == nil {
		tx.attributeViewStorageContexts = map[string]string{}
	}
	tx.attributeViewStorageContexts[source.ID] = context.storageBoxID
	op.relationDetailContext = context
	for _, undo := range tx.UndoOperations {
		if undo.Action == op.Action && undo.AvID == op.AvID && undo.KeyID == op.KeyID {
			undo.relationDetailContext = context
		}
	}
	if err = tx.rememberAutomationView(source, op.BlockID); err != nil {
		return err
	}
	key.Relation.DetailView = config
	if err = avSaveView(source, op.BlockID); err != nil {
		return err
	}
	if !tx.isReplay {
		after, marshalErr := json.Marshal(config)
		if marshalErr != nil {
			return marshalErr
		}
		op.relationDetailConfig = &attributeViewRelationDetailSnapshot{context: *context, keyID: op.KeyID,
			targetID: key.Relation.AvID, before: string(before), after: string(after)}
		op.Data = json.RawMessage(append([]byte(nil), after...))
		if tx.relationDetailUndoUsed == nil {
			tx.relationDetailUndoUsed = map[*Operation]bool{}
		}
		for i := len(tx.UndoOperations) - 1; i >= 0; i-- {
			undo := tx.UndoOperations[i]
			if undo.Action != op.Action || undo.AvID != op.AvID || undo.KeyID != op.KeyID || tx.relationDetailUndoUsed[undo] {
				continue
			}
			undo.relationDetailConfig, undo.relationDetailConfigUndo = op.relationDetailConfig, true
			undo.Data = json.RawMessage(append([]byte(nil), before...))
			tx.relationDetailUndoUsed[undo] = true
			break
		}
	}
	ReloadAttrView(source.ID)
	return nil
}

func (tx *Transaction) doUpdateAttrViewRelationItems(op *Operation) *TxErr {
	if err := tx.updateAttrViewRelationItems(op); err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()}
	}
	return nil
}

func (tx *Transaction) updateAttrViewRelationItems(op *Operation) error {
	if op.attributeViewRelationSubItems != nil {
		return tx.replayAttributeViewRelationSubItems(op)
	}
	context := op.relationDetailContext
	if context == nil {
		context = &AttributeViewRelationContext{SourceAvID: op.AvID, SourceItemID: op.RowID, RelationKeyID: op.KeyID}
	}
	scope, err := tx.resolveRelationChangeScope(op, context, "", false)
	if err != nil {
		return err
	}
	op.relationDetailContext = context
	data, err := json.Marshal(op.Data)
	if err != nil {
		return err
	}
	var change AttributeViewRelationItemsChange
	if err = json.Unmarshal(data, &change); err != nil {
		return err
	}
	if len(change.AddItemIDs)+len(change.RemoveItemIDs) > 10000 {
		return errors.New("too many relation changes")
	}
	for _, id := range append(slices.Clone(change.AddItemIDs), change.RemoveItemIDs...) {
		if !ast.IsNodeIDPattern(id) {
			return ErrInvalidID
		}
	}
	for _, id := range change.AddItemIDs {
		if slices.Contains(change.RemoveItemIDs, id) || scope.target.GetBlockValue(id) == nil {
			return av.ErrItemNotFound
		}
	}
	parentSelection := scope.source.HasSubItems() && op.KeyID == scope.source.SubItems.ParentKeyID
	if parentSelection && len(change.AddItemIDs) > 1 {
		return errors.New("database sub-item parent selection requires one item")
	}
	if !tx.isReplay && len(change.AddItemIDs) > 0 && hasAttrViewFilterConditions(scope.key.Relation.CandidateFilters) {
		table := renderAttributeViewRelationCandidates(scope.target)
		if table == nil {
			return av.ErrViewNotFound
		}
		table.Filters = av.CloneFilters(scope.key.Relation.CandidateFilters)
		cached := map[string]*av.AttributeView{scope.target.ID: scope.target}
		av.Filter(table, scope.target, sql.GetFurtherCollections(scope.target, cached), cached)
		eligible := map[string]bool{}
		for _, row := range table.Rows {
			eligible[row.ID] = true
		}
		for _, id := range change.AddItemIDs {
			if !slices.Contains(scope.itemIDs, id) && !eligible[id] {
				return errors.New("item does not match relation candidate filters")
			}
		}
	}
	replayCapture, err := tx.beginRelationCellReplay([]*Operation{op})
	if err != nil {
		return err
	}
	current := slices.Clone(scope.itemIDs)
	actual := AttributeViewRelationItemsChange{AddItemIDs: []string{}, RemoveItemIDs: []string{}}
	removing := slices.Clone(change.RemoveItemIDs)
	if parentSelection && len(change.AddItemIDs) == 1 {
		// 父项单选按执行时的关系替换，撤销仍只恢复本次实际变化，不能使用面板打开时的旧父项。
		for _, id := range current {
			if id != change.AddItemIDs[0] && !slices.Contains(removing, id) {
				removing = append(removing, id)
			}
		}
	}
	for _, id := range removing {
		if slices.Contains(current, id) {
			actual.RemoveItemIDs = append(actual.RemoveItemIDs, id)
			current = slices.DeleteFunc(current, func(value string) bool { return value == id })
		}
	}
	for _, id := range change.AddItemIDs {
		if !slices.Contains(current, id) {
			actual.AddItemIDs = append(actual.AddItemIDs, id)
			current = append(current, id)
		}
	}
	var subItemsBefore *av.SubItemsIndex
	if scope.source.IsSubItemsKey(op.KeyID) {
		if subItemsBefore, err = scope.source.BuildSubItemsIndex(); err != nil {
			return err
		}
	}
	tx.attributeViewItemCreation = true
	if err = tx.rememberAutomationView(scope.source, op.BlockID); err != nil {
		return err
	}
	value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: current}}
	if _, err = updateAttributeViewValue(tx, scope.source, op.KeyID, op.RowID, value, true, op.BlockID); err != nil {
		return err
	}
	var replayInverse *Operation
	if !tx.isReplay {
		if subItemsBefore != nil {
			if op.attributeViewRelationSubItems, err = captureAttributeViewRelationSubItems(context, scope, subItemsBefore); err != nil {
				return err
			}
		}
		op.Data = actual
		if tx.relationDetailUndoUsed == nil {
			tx.relationDetailUndoUsed = map[*Operation]bool{}
		}
		// 撤销按逆序执行，相同请求的重复操作也必须分别对应其实际变化。
		for i := len(tx.UndoOperations) - 1; i >= 0; i-- {
			undo := tx.UndoOperations[i]
			if undo.Action != op.Action || undo.AvID != op.AvID || undo.RowID != op.RowID || undo.KeyID != op.KeyID || tx.relationDetailUndoUsed[undo] {
				continue
			}
			data, marshalErr := json.Marshal(undo.Data)
			var inverse AttributeViewRelationItemsChange
			if marshalErr != nil || json.Unmarshal(data, &inverse) != nil || !slices.Equal(inverse.AddItemIDs, change.RemoveItemIDs) || !slices.Equal(inverse.RemoveItemIDs, change.AddItemIDs) {
				continue
			}
			undo.Data = AttributeViewRelationItemsChange{AddItemIDs: actual.RemoveItemIDs, RemoveItemIDs: actual.AddItemIDs}
			undo.attributeViewRelationSubItems = op.attributeViewRelationSubItems
			undo.attributeViewRelationSubUndo = op.attributeViewRelationSubItems != nil
			undo.relationDetailContext = context
			tx.relationDetailUndoUsed[undo] = true
			replayInverse = undo
			break
		}
	}
	if err = tx.finishRelationCellReplay(replayCapture, replayInverse); err != nil {
		return err
	}
	if subItemsBefore != nil {
		refreshRelatedSrcAvsInBlock(scope.source.ID, op.BlockID, tx)
	}
	ReloadAttrView(scope.source.ID)
	return nil
}

func (tx *Transaction) parseAttributeViewForOperation(avID, blockID string) (*av.AttributeView, error) {
	if tx != nil {
		if boxID, exists := tx.attributeViewStorageContexts[avID]; exists {
			carrierBox, exact, err := resolveAttributeViewCarrierBoxID(blockID)
			if err != nil {
				return nil, err
			}
			if exact && boxID != carrierBox {
				return nil, errors.New("database operation changed encryption boundary")
			}
			return av.ParseAttributeViewWithStorageContext(avID, boxID)
		}
	}
	return avParseView(avID, blockID)
}

func (tx *Transaction) validateAttributeViewRelationCellOperation(op *Operation) error {
	if op.RelationContext == nil {
		if op.relationCellReplay != nil && (op.Action != "updateAttrViewRelationItems" || op.relationCellContext == nil) {
			return errors.New("relation cell replay context is missing")
		}
		return nil
	}
	if op.Action != "updateAttrViewCell" && op.Action != "updateAttrViewCells" {
		return errors.New("operation is not supported in relation detail context")
	}
	ids := []string{op.RowID}
	if op.Action == "updateAttrViewCells" {
		ids = nil
		for _, cell := range op.CellUpdates {
			if cell == nil {
				return errors.New("invalid relation detail cell")
			}
			ids = append(ids, cell.RowID)
		}
	}
	_, err := tx.resolveRelationCellReplayScope(op, op.RelationContext, op.AvID, ids)
	return err
}

func attributeViewRelationCarrierIDs(view *av.AttributeView) ([]string, error) {
	boxID, scoped := view.StorageContext()
	if !scoped {
		return treenode.GetMirrorAttrViewBlockIDs(view.ID), nil
	}
	ids, err := av.GetAttributeViewBlockIDsInBox(view.ID, boxID)
	if err != nil {
		return nil, err
	}
	ret := []string{}
	for _, id := range ids {
		tree, loadErr := LoadTreeByBlockIDInExactBox(id, boxID)
		if loadErr != nil {
			continue
		}
		node := treenode.GetNodeInTree(tree, id)
		if node != nil && node.Type == ast.NodeAttributeView && node.AttributeViewID == view.ID && IsSameCryptoBoundary(boxID, tree.Box) {
			ret = append(ret, id)
		}
	}
	return ret, nil
}
