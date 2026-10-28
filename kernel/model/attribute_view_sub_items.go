package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

type attributeViewSubItemsData struct {
	Enabled       *bool  `json:"enabled"`
	ParentKeyID   string `json:"parentKeyID,omitempty"`
	ChildrenKeyID string `json:"childrenKeyID,omitempty"`
	ParentName    string `json:"parentName,omitempty"`
	ChildrenName  string `json:"childrenName,omitempty"`
}

type attributeViewCreatedSubItemsSnapshot struct {
	parentKeyID, childrenKeyID string
	before, after              map[string]string
}

func (tx *Transaction) doAttributeViewSubItems(op *Operation) *TxErr {
	if err := tx.changeAttributeViewSubItems(op); err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()}
	}
	return nil
}

func (tx *Transaction) changeAttributeViewSubItems(op *Operation) error {
	if op.attributeViewFields != nil {
		return tx.replayAttributeViewFields(op)
	}
	if _, err := avParseView(op.AvID, op.BlockID); err != nil {
		return err
	}
	boxID := av.GetAVBoxID(op.AvID)
	source, err := tx.readAttributeViewForMutation(op.AvID, op.BlockID, boxID)
	if err != nil {
		return err
	}
	current, err := cloneAttributeViewForFieldMutation(source)
	if err != nil {
		return err
	}
	before := map[string]*av.AttributeView{source.ID: source}
	after := map[string]*av.AttributeView{current.ID: current}
	switch op.Action {
	case "setAttrViewSubItems":
		data := &attributeViewSubItemsData{}
		encoded, e := json.Marshal(op.Data)
		if e != nil {
			return e
		}
		if e = json.Unmarshal(encoded, data); e != nil {
			return e
		}
		if data.Enabled == nil {
			return errors.New("database sub-items require an explicit enabled boolean")
		}
		if !*data.Enabled {
			if current.SubItems != nil {
				current.SubItems.Enabled = false
			}
			for _, view := range current.Views {
				view.SubItemsDisplay = "flat"
			}
			break
		}
		if data.ParentKeyID == "" && data.ChildrenKeyID == "" && current.SubItems != nil {
			data.ParentKeyID, data.ChildrenKeyID = current.SubItems.ParentKeyID, current.SubItems.ChildrenKeyID
		}
		if (data.ParentKeyID == "") != (data.ChildrenKeyID == "") {
			return errors.New("both database sub-item fields are required")
		}
		if current.HasSubItems() && (current.SubItems.ParentKeyID != data.ParentKeyID || current.SubItems.ChildrenKeyID != data.ChildrenKeyID) {
			return errors.New("disable database sub-items before replacing their fields")
		}
		if data.ParentKeyID == "" {
			data.ParentKeyID, data.ChildrenKeyID = ast.NewNodeID(), ast.NewNodeID()
			for _, definition := range []struct{ id, back, name string }{{data.ParentKeyID, data.ChildrenKeyID, data.ParentName}, {data.ChildrenKeyID, data.ParentKeyID, data.ChildrenName}} {
				name := strings.TrimSpace(definition.name)
				if name == "" {
					if definition.id == data.ParentKeyID {
						name = "Parent item"
					} else {
						name = "Sub-items"
					}
				}
				key := &av.Key{ID: definition.id, Name: name, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: current.ID, IsTwoWay: true, BackKeyID: definition.back}}
				addAttributeViewKey(current, current.GetView(op.ViewID), key, "")
				current.KeyIDs = append(current.KeyIDs, definition.id)
				for _, view := range current.Views {
					if view.Table != nil {
						for _, field := range view.Table.Columns {
							if field.ID == definition.id {
								field.Hidden = true
							}
						}
					}
				}
			}
		}
		current.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: data.ParentKeyID, ChildrenKeyID: data.ChildrenKeyID}
		if err = current.ValidateSubItems(); err != nil {
			return err
		}
		if op.ViewID != "" {
			view, viewErr := resolveAttributeViewView(current, op.ViewID, "", op.BlockID)
			if viewErr != nil {
				return viewErr
			}
			if view.LayoutType == av.LayoutTypeTable || view.LayoutType == av.LayoutTypeList {
				view.SubItemsDisplay = "nested"
			}
		}
	case "setAttrViewSubItemsDisplay":
		display, ok := op.Data.(string)
		if !ok || (display != "flat" && display != "nested") {
			return errors.New("invalid database sub-item display")
		}
		view, e := resolveAttributeViewView(current, op.ViewID, "", op.BlockID)
		if e != nil {
			return e
		}
		if display == "nested" && !current.HasSubItems() {
			return errors.New("database sub-items are disabled")
		}
		view.SubItemsDisplay = display
	case "reparentAttrViewItems", "promoteAttrViewItems", "duplicateAttrViewSubtree":
		if !current.HasSubItems() {
			return errors.New("database sub-items are disabled")
		}
		index, e := current.BuildSubItemsIndex()
		if e != nil {
			return e
		}
		ids, e := subItemSelectionRoots(index, op.SrcIDs)
		if e != nil {
			return e
		}
		if op.Action == "promoteAttrViewItems" {
			ids = slices.DeleteFunc(ids, func(id string) bool { return index.Parents[id] == "" })
		}
		if op.Action == "duplicateAttrViewSubtree" {
			if e = tx.duplicateAttributeViewSubtree(current, index, ids, op, before, after); e != nil {
				return e
			}
		} else {
			changes := map[string]string{}
			for _, id := range ids {
				parent := op.ParentID
				if op.Action == "promoteAttrViewItems" {
					parent = index.Parents[index.Parents[id]]
				}
				changes[id] = parent
			}
			if e = current.SetSubItemsParents(changes); e != nil {
				return e
			}
			if op.PreviousID != "" && op.NextID != "" {
				return errors.New("database sub-item order accepts one anchor")
			}
			anchor := op.PreviousID
			if op.NextID != "" {
				anchor = op.NextID
			}
			if anchor != "" {
				updated, e := current.BuildSubItemsIndex()
				if e != nil {
					return e
				}
				if _, exists := updated.Parents[anchor]; !exists || slices.Contains(ids, anchor) || updated.Parents[anchor] != op.ParentID {
					return errors.New("database sub-item order requires a sibling anchor")
				}
			}
			if op.ViewID != "" {
				view, e := resolveAttributeViewView(current, op.ViewID, "", op.BlockID)
				if e != nil {
					return e
				}
				if len(view.Sorts) > 0 && anchor != "" {
					return errors.New("manual database ordering is unavailable while sorting")
				}
				if len(view.Sorts) == 0 {
					if op.GroupID != "" && view.GetGroupByID(op.GroupID) == nil {
						return av.ErrViewNotFound
					}
					updated, indexErr := current.BuildSubItemsIndex()
					if indexErr != nil {
						return indexErr
					}
					moveSubItemOrder(view, updated, ids, op.PreviousID, op.NextID, op.GroupID)
					if op.GroupID != "" {
						for _, id := range ids {
							if index.Parents[id] != updated.Parents[id] {
								view.ItemIDs = moveSubItemIDs(view.ItemIDs, ids, op.PreviousID, op.NextID)
								break
							}
						}
					}
				}
			}
		}
	default:
		return errors.New("unknown database sub-item operation")
	}
	av.UpgradeSpec(current)
	regenAttrViewGroups(current)
	state := &attributeViewFieldsSnapshot{avID: op.AvID, keyID: op.AvID, blockID: op.BlockID, boxID: boxID, changes: map[string]*attributeViewFieldChange{}}
	if err = tx.saveAttributeViewFieldChanges(state, before, after); err != nil {
		return err
	}
	return tx.captureSubItemsChanges([]*Operation{op}, before, after)
}

func subItemSelectionRoots(index *av.SubItemsIndex, ids []string) ([]string, error) {
	selected := map[string]bool{}
	for _, id := range ids {
		if _, ok := index.Parents[id]; !ok {
			return nil, av.ErrItemNotFound
		}
		selected[id] = true
	}
	keep := map[string]bool{}
	type visit struct {
		id      string
		covered bool
	}
	stack := []visit{}
	for _, id := range index.Roots {
		stack = append(stack, visit{id: id})
	}
	for len(stack) > 0 {
		next := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if selected[next.id] && !next.covered {
			keep[next.id] = true
		}
		for _, child := range index.Children[next.id] {
			stack = append(stack, visit{id: child, covered: next.covered || selected[next.id]})
		}
	}
	ret := []string{}
	for _, id := range ids {
		if keep[id] {
			ret = append(ret, id)
			delete(keep, id)
		}
	}
	if len(ret) == 0 {
		return nil, errors.New("database sub-item selection is empty")
	}
	return ret, nil
}

func subItemRootIdentities(index *av.SubItemsIndex) (map[string]string, []string) {
	rootByID := map[string]string{}
	order := make([]string, 0, len(index.Parents))
	for _, root := range index.Roots {
		pending := []string{root}
		for len(pending) > 0 {
			id := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			rootByID[id] = root
			order = append(order, id)
			for i := len(index.Children[id]) - 1; i >= 0; i-- {
				pending = append(pending, index.Children[id][i])
			}
		}
	}
	return rootByID, order
}

func subItemGroupRoots(group *av.View, rootByID map[string]string) map[string]bool {
	roots := map[string]bool{}
	for _, id := range group.GroupItemIDs {
		if rootByID[id] == id {
			roots[id] = true
		}
	}
	return roots
}

// 关系编辑或分组重建后，只保留仍属于根所在树形组的排序条目。
func pruneSubItemGroupOrders(view *av.View, rootByID map[string]string) {
	for _, group := range view.Groups {
		if len(group.SubItemsItemIDs) == 0 {
			continue
		}
		roots := subItemGroupRoots(group, rootByID)
		seen := map[string]bool{}
		group.SubItemsItemIDs = slices.DeleteFunc(slices.Clone(group.SubItemsItemIDs), func(id string) bool {
			if !roots[rootByID[id]] || seen[id] {
				return true
			}
			seen[id] = true
			return false
		})
	}
}

func moveSubItemOrder(view *av.View, index *av.SubItemsIndex, ids []string, previousID, nextID string, groupIDs ...string) {
	rootByID, sourceOrder := subItemRootIdentities(index)
	pruneSubItemGroupOrders(view, rootByID)
	selectedRoots := map[string]bool{}
	for _, id := range ids {
		selectedRoots[rootByID[id]] = true
	}
	type groupOrder struct {
		group *av.View
		roots map[string]bool
		seen  map[string]bool
		ids   []string
		moved []string
	}
	active := []*groupOrder{}
	groupsByRoot := map[string][]*groupOrder{}
	// 未指定分组时同步现有分组；指定后仅调整操作所在组，保留其他组的独立手工排序。
	for _, group := range view.Groups {
		if len(groupIDs) > 0 && groupIDs[0] != "" && group.ID != groupIDs[0] {
			continue
		}
		plan := &groupOrder{group: group, roots: subItemGroupRoots(group, rootByID), seen: map[string]bool{}}
		affected := false
		for root := range plan.roots {
			affected = affected || selectedRoots[root]
		}
		if !affected {
			continue
		}
		order := group.SubItemsItemIDs
		if len(order) == 0 {
			order = group.GroupItemIDs
		}
		for _, id := range order {
			if plan.roots[rootByID[id]] && !plan.seen[id] {
				plan.ids = append(plan.ids, id)
				plan.seen[id] = true
			}
		}
		for root := range plan.roots {
			groupsByRoot[root] = append(groupsByRoot[root], plan)
		}
		active = append(active, plan)
	}
	// 只补齐实际树形组中的条目，存储量按展示成员计算，不为每组复制全库。
	for _, order := range [][]string{view.ItemIDs, sourceOrder} {
		for _, id := range order {
			for _, plan := range groupsByRoot[rootByID[id]] {
				if !plan.seen[id] {
					plan.ids = append(plan.ids, id)
					plan.seen[id] = true
				}
			}
		}
	}
	for _, id := range ids {
		for _, plan := range groupsByRoot[rootByID[id]] {
			plan.moved = append(plan.moved, id)
		}
	}
	for _, plan := range active {
		flatIDs := attributeViewItemIDSet(plan.group.GroupItemIDs)
		flatMoved := []string{}
		for _, id := range plan.moved {
			if flatIDs[id] {
				flatMoved = append(flatMoved, id)
			}
		}
		plan.group.SubItemsItemIDs = moveSubItemIDs(plan.ids, plan.moved, previousID, nextID)
		plan.group.GroupItemIDs = moveSubItemIDs(plan.group.GroupItemIDs, flatMoved, previousID, nextID)
	}
	// 同父项在指定组中的重排不改变其他组及全局平铺顺序。
	if len(groupIDs) == 0 || groupIDs[0] == "" {
		view.ItemIDs = moveSubItemIDs(view.ItemIDs, ids, previousID, nextID)
	}
}

func moveSubItemIDs(order, ids []string, previousID, nextID string) []string {
	remaining := []string{}
	moved := map[string]bool{}
	for _, id := range ids {
		moved[id] = true
	}
	for _, id := range order {
		if !moved[id] {
			remaining = append(remaining, id)
		}
	}
	position := len(remaining)
	if previousID != "" {
		if index := slices.Index(remaining, previousID); index >= 0 {
			position = index + 1
		}
	}
	if nextID != "" {
		position = slices.Index(remaining, nextID)
		if position < 0 {
			position = len(remaining)
		}
	}
	return slices.Insert(remaining, position, ids...)
}

// 差异快照还原所有受影响的反向边，包括视图外的条目；后续修改冲突时拒绝覆盖。
// 格式升级不参与撤销，停用功能后也不降级。
func (tx *Transaction) captureSubItemsChanges(operations []*Operation, before, after map[string]*av.AttributeView) error {
	if tx == nil || tx.isReplay || !tx.fromAPI {
		return nil
	}
	first := operations[0]
	state := &attributeViewFieldsSnapshot{avID: first.AvID, keyID: first.AvID, blockID: first.BlockID, boxID: av.GetAVBoxID(first.AvID), changes: map[string]*attributeViewFieldChange{}}
	for id, original := range before {
		updated := after[id]
		if updated == nil {
			continue
		}
		oldJSON, err := attributeViewFieldJSON(original)
		if err != nil {
			return err
		}
		newJSON, err := attributeViewFieldJSON(updated)
		if err != nil {
			return err
		}
		// 可逆差异两端都使用升级后的格式版本。
		oldJSON.(map[string]any)["spec"] = newJSON.(map[string]any)["spec"]
		if change := diffAttributeViewFields(oldJSON, newJSON, true, true); change != nil {
			state.changes[id] = change
		}
	}
	// 撤销操作按执行的逆序排列，每个正向操作只消费一个对应项。
	// 连续单元格批次共用一个快照，但不能吞掉同事务中后续的同名操作。
	matched := map[int]bool{}
	for _, op := range operations {
		for i := len(tx.UndoOperations) - 1; i >= 0; i-- {
			undo := tx.UndoOperations[i]
			if matched[i] || undo.attributeViewFields != nil || undo.AvID != op.AvID || undo.Action != op.Action {
				continue
			}
			if op.Action == "updateAttrViewCell" && (undo.RowID != op.RowID || undo.KeyID != op.KeyID) {
				continue
			}
			if len(op.SrcIDs) > 0 && !slices.Equal(undo.SrcIDs, op.SrcIDs) {
				continue
			}
			matched[i] = true
			break
		}
	}
	if len(matched) == 0 {
		return nil
	}
	assigned := false
	for i, undo := range tx.UndoOperations {
		if !matched[i] {
			continue
		}
		undo.ID, undo.attributeViewFieldUndo = first.AvID, true
		undo.attributeViewFields = &attributeViewFieldsSnapshot{avID: first.AvID, keyID: first.AvID}
		if !assigned {
			undo.attributeViewFields, assigned = state, true
		}
	}
	for i, op := range operations {
		op.ID = first.AvID
		if i == 0 {
			op.attributeViewFields = state
		} else {
			op.attributeViewFields = &attributeViewFieldsSnapshot{avID: first.AvID, keyID: first.AvID}
		}
	}
	return nil
}

func subItemsCellChanges(source *av.AttributeView, cells []*AttrViewCellUpdate) (map[string]string, error) {
	index, err := source.BuildSubItemsIndex()
	if err != nil {
		return nil, err
	}
	changes := map[string]string{}
	cleared := map[string]bool{}
	assign := func(id, parent string) error {
		if previous, exists := changes[id]; exists && previous != parent {
			return fmt.Errorf("database sub-item batch assigns conflicting parents to entry [%s]", id)
		}
		changes[id] = parent
		return nil
	}
	for _, cell := range cells {
		if cell == nil || !source.IsSubItemsKey(cell.KeyID) {
			continue
		}
		if _, exists := index.Parents[cell.RowID]; !exists {
			return nil, av.ErrItemNotFound
		}
		encoded, err := json.Marshal(cell.Data)
		if err != nil {
			return nil, err
		}
		value := &av.Value{}
		if err = json.Unmarshal(encoded, value); err != nil {
			return nil, err
		}
		if value.Relation == nil {
			return nil, errors.New("database sub-item relation value is required")
		}
		ids := value.Relation.BlockIDs
		if cell.KeyID == source.SubItems.ParentKeyID {
			if len(ids) > 1 {
				return nil, fmt.Errorf("database entry [%s] can only have one parent", cell.RowID)
			}
			parent := ""
			if len(ids) == 1 {
				parent = ids[0]
			}
			if err = assign(cell.RowID, parent); err != nil {
				return nil, err
			}
		} else {
			for _, child := range index.Children[cell.RowID] {
				cleared[child] = true
			}
			for _, child := range ids {
				if err = assign(child, cell.RowID); err != nil {
					return nil, err
				}
			}
		}
	}
	for id := range cleared {
		if _, assigned := changes[id]; !assigned {
			changes[id] = ""
		}
	}
	return changes, nil
}

func (tx *Transaction) updateSubItemsCells(operations []*Operation, cells []*AttrViewCellUpdate, source *av.AttributeView) (handled bool, err error) {
	op := operations[0]
	if op.attributeViewFields != nil {
		for _, operation := range operations {
			if err = tx.replayAttributeViewFields(operation); err != nil {
				return true, err
			}
		}
		return true, nil
	}
	for _, cell := range cells {
		if cell != nil && source.IsSubItemsKey(cell.KeyID) {
			handled = true
			break
		}
	}
	if !handled {
		return false, nil
	}
	boxID := av.GetAVBoxID(source.ID)
	source, err = tx.readAttributeViewForMutation(source.ID, op.BlockID, boxID)
	if err != nil {
		return true, err
	}
	before := map[string]*av.AttributeView{source.ID: source}
	for _, kv := range source.KeyValues {
		if kv.Key.Type != av.KeyTypeRelation || kv.Key.Relation == nil || !kv.Key.Relation.IsTwoWay || kv.Key.Relation.AvID == "" || before[kv.Key.Relation.AvID] != nil {
			continue
		}
		linked, e := tx.readAttributeViewForMutation(kv.Key.Relation.AvID, op.BlockID, boxID)
		if e != nil {
			return true, e
		}
		before[linked.ID] = linked
	}
	current, err := cloneAttributeViewForFieldMutation(source)
	if err != nil {
		return true, err
	}
	if err = preflightAttributeViewCellBindings(tx, current, cells); err != nil {
		return true, err
	}
	changes, err := subItemsCellChanges(current, cells)
	if err != nil {
		return true, err
	}
	if err = current.SetSubItemsParents(changes); err != nil {
		return true, err
	}
	if err = tx.rememberAttributeViewMutationTree(op.BlockID); err != nil {
		return true, err
	}
	for id, original := range before {
		key := boxID + "/" + id
		if tx.attributeViewRollback.views[key] == nil {
			tx.attributeViewRollback.views[key] = original
		}
	}
	for _, cell := range cells {
		if cell == nil {
			return true, errors.New("invalid database cell update")
		}
		if current.IsSubItemsKey(cell.KeyID) {
			continue
		}
		if _, err = updateAttributeViewValue(tx, current, cell.KeyID, cell.RowID, cell.Data, false, op.BlockID); err != nil {
			return true, err
		}
	}
	regenAttrViewGroups(current)
	if err = avSaveView(current, op.BlockID); err != nil {
		return true, err
	}
	after := map[string]*av.AttributeView{current.ID: current}
	for id := range before {
		if id != current.ID {
			after[id], err = tx.readAttributeViewForMutation(id, op.BlockID, boxID)
			if err != nil {
				return true, err
			}
		}
	}
	err = tx.captureSubItemsChanges(operations, before, after)
	if err == nil && op.attributeViewFields == nil {
		err = tx.captureCreatedSubItemsChanges(source, current)
	}
	refreshRelatedSrcAvsInBlock(current.ID, op.BlockID, tx)
	return true, err
}

// 模板可能通过子项字段接管已有条目，删除新条目不足以撤销这些边。
// 仅记录已有条目的语义关系，重做重新创建新条目后仍可重复撤销，不依赖新值的随机 ID。
func (tx *Transaction) captureCreatedSubItemsChanges(before, after *av.AttributeView) error {
	if !tx.attributeViewItemCreation || tx.isReplay || !tx.fromAPI || !before.HasSubItems() {
		return nil
	}
	oldIndex, err := before.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	newIndex, err := after.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	for _, undo := range tx.UndoOperations {
		if undo.Action != "removeAttrViewBlock" || undo.AvID != before.ID {
			continue
		}
		removed := attributeViewItemIDSet(undo.SrcIDs)
		for id, parent := range oldIndex.Parents {
			if removed[id] || newIndex.Parents[id] == parent {
				continue
			}
			state := undo.attributeViewCreatedSubItems
			if state == nil {
				state = &attributeViewCreatedSubItemsSnapshot{parentKeyID: before.SubItems.ParentKeyID, childrenKeyID: before.SubItems.ChildrenKeyID,
					before: map[string]string{}, after: map[string]string{}}
				undo.attributeViewCreatedSubItems = state
			}
			if _, exists := state.before[id]; !exists {
				state.before[id] = parent
			}
			state.after[id] = newIndex.Parents[id]
		}
		if undo.attributeViewCreatedSubItems != nil {
			for _, operation := range tx.DoOperations {
				if operation.Action != "insertAttrViewBlock" || operation.AvID != undo.AvID {
					continue
				}
				for _, src := range operation.Srcs {
					if id, ok := src["itemID"].(string); ok && removed[id] {
						operation.attributeViewCreatedSubItems = undo.attributeViewCreatedSubItems
					}
				}
			}
		}
	}
	return nil
}

func (tx *Transaction) restoreCreatedSubItemsChanges(op *Operation) error {
	current, err := tx.validateCreatedSubItemsChanges(op, true)
	if err != nil || current == nil {
		return err
	}
	updated, err := cloneAttributeViewForFieldMutation(current)
	if err != nil {
		return err
	}
	if err = updated.SetSubItemsParents(op.attributeViewCreatedSubItems.before); err != nil {
		return err
	}
	regenAttrViewGroups(updated)
	return tx.saveAttributeViewFieldChanges(&attributeViewFieldsSnapshot{avID: op.AvID, blockID: op.BlockID, boxID: av.GetAVBoxID(op.AvID)},
		map[string]*av.AttributeView{op.AvID: current}, map[string]*av.AttributeView{op.AvID: updated})
}

func (tx *Transaction) validateCreatedSubItemsChanges(op *Operation, undo bool) (*av.AttributeView, error) {
	state := op.attributeViewCreatedSubItems
	if state == nil {
		return nil, nil
	}
	if !tx.isReplay {
		return nil, errors.New("invalid created database sub-items replay")
	}
	current, err := tx.readAttributeViewForMutation(op.AvID, op.BlockID, av.GetAVBoxID(op.AvID))
	if err != nil {
		return nil, err
	}
	if !current.HasSubItems() || current.SubItems.ParentKeyID != state.parentKeyID || current.SubItems.ChildrenKeyID != state.childrenKeyID {
		return nil, errors.New("database sub-item configuration changed after item creation")
	}
	index, err := current.BuildSubItemsIndex()
	if err != nil {
		return nil, err
	}
	expectedParents := state.before
	if undo {
		expectedParents = state.after
	}
	for id, expected := range expectedParents {
		if parent, exists := index.Parents[id]; !exists || parent != expected {
			return nil, fmt.Errorf("database parent of entry [%s] changed after item creation", id)
		}
	}
	return current, nil
}

func (tx *Transaction) duplicateAttributeViewSubtree(current *av.AttributeView, index *av.SubItemsIndex, roots []string, op *Operation, before, after map[string]*av.AttributeView) error {
	ids := []string{}
	stack := slices.Clone(roots)
	slices.Reverse(stack)
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		ids = append(ids, id)
		children := slices.Clone(index.Children[id])
		slices.Reverse(children)
		stack = append(stack, children...)
	}
	remap := map[string]string{}
	copiedIDs := map[string]bool{}
	for _, id := range ids {
		remap[id] = ast.NewNodeID()
		copiedIDs[remap[id]] = true
	}
	now := time.Now().UnixMilli()
	for _, kv := range current.KeyValues {
		if current.IsSubItemsKey(kv.Key.ID) || av.HasKeyGroup(kv.Key.Type, av.KeyGroupSkipRowCopy) {
			continue
		}
		for _, original := range slices.Clone(kv.Values) {
			id := remap[original.BlockID]
			if id == "" {
				continue
			}
			value := original.Clone()
			if value == nil {
				return errors.New("copy database sub-item failed")
			}
			value.ID, value.BlockID, value.CreatedAt, value.UpdatedAt = ast.NewNodeID(), id, now, now
			value.IsRenderAutoFill = false
			if value.Block != nil {
				value.IsDetached = true
				value.Block.ID = ""
				value.Block.RefSubtype = ""
				value.Block.CollectionRuleID = ""
				value.Block.Created, value.Block.Updated = now, now
			}
			if value.Relation != nil {
				value.Relation.Contents = nil
				if kv.Key.Relation != nil && kv.Key.Relation.AvID == current.ID {
					for i, target := range value.Relation.BlockIDs {
						if remap[target] != "" {
							value.Relation.BlockIDs[i] = remap[target]
						}
					}
				}
			}
			kv.Values = append(kv.Values, value)
		}
	}
	changes := map[string]string{}
	for _, id := range ids {
		parent := index.Parents[id]
		if remap[parent] != "" {
			parent = remap[parent]
		}
		changes[remap[id]] = parent
	}
	if err := current.SetSubItemsParents(changes); err != nil {
		return err
	}
	// 普通双向关联沿用复制条目的语义。
	for _, kv := range current.KeyValues {
		if current.IsSubItemsKey(kv.Key.ID) || kv.Key.Relation == nil || !kv.Key.Relation.IsTwoWay || kv.Key.Relation.AvID == "" {
			continue
		}
		var dest *av.AttributeView
		if kv.Key.Relation.AvID == current.ID {
			dest = current
		} else {
			dest = after[kv.Key.Relation.AvID]
			if dest == nil {
				original, err := tx.readAttributeViewForMutation(kv.Key.Relation.AvID, op.BlockID, av.GetAVBoxID(current.ID))
				if err != nil {
					return err
				}
				before[original.ID] = original
				dest, err = cloneAttributeViewForFieldMutation(original)
				if err != nil {
					return err
				}
				after[dest.ID] = dest
			}
		}
		back, err := dest.GetKeyValues(kv.Key.Relation.BackKeyID)
		if err != nil {
			return err
		}
		backValues := map[string]*av.Value{}
		for _, value := range back.Values {
			backValues[value.BlockID] = value
		}
		for _, value := range kv.Values {
			if !copiedIDs[value.BlockID] || value.Relation == nil {
				continue
			}
			for _, target := range value.Relation.BlockIDs {
				reverse := backValues[target]
				if reverse == nil {
					reverse = &av.Value{ID: ast.NewNodeID(), KeyID: back.Key.ID, BlockID: target, Type: av.KeyTypeRelation, Relation: &av.ValueRelation{}, CreatedAt: now, UpdatedAt: now}
					back.Values = append(back.Values, reverse)
					backValues[target] = reverse
				}
				if reverse.Relation == nil {
					reverse.Relation = &av.ValueRelation{}
				}
				if !slices.Contains(reverse.Relation.BlockIDs, value.BlockID) {
					reverse.Relation.BlockIDs = append(reverse.Relation.BlockIDs, value.BlockID)
				}
			}
		}
	}
	newIDs := make([]string, len(ids))
	for i, id := range ids {
		newIDs[i] = remap[id]
		current.CopyCardCoverPositions(id, remap[id])
	}
	updatedIndex, err := current.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	for _, view := range current.Views {
		for _, group := range view.Groups {
			copied := []string{}
			for _, id := range group.GroupItemIDs {
				if replacement := remap[id]; replacement != "" {
					copied = append(copied, replacement)
				}
			}
			group.GroupItemIDs = append(group.GroupItemIDs, copied...)
		}
		anchor := op.PreviousID
		if anchor == "" {
			anchor = roots[len(roots)-1]
		}
		moveSubItemOrder(view, updatedIndex, newIDs, anchor, "")
	}
	op.RetData = &insertAttrViewBlockResult{InsertedItemIDs: newIDs, ExistingItemIDs: []string{}}
	return nil
}

// 整库复制重新分配字段、条目、值和视图身份，并保留绑定块与外部关联的身份。
func remapCopiedSubItemsDatabase(source *av.AttributeView, databaseID ...string) (*av.AttributeView, error) {
	if source.SubItems == nil {
		return source, nil
	}
	ids := newAttributeViewIdentityMap(source)
	ret, err := remapAttributeViewLocalIdentities(source, ids)
	if err != nil {
		return nil, err
	}
	databaseIDs := map[string]string{}
	if len(databaseID) > 0 {
		ret.ID, databaseIDs[source.ID] = databaseID[0], databaseID[0]
	}
	remapAttributeViewReferences(source, ret, map[string]*av.AttributeView{source.ID: source}, map[string]map[string]string{source.ID: ids}, databaseIDs)
	remapAttributeViewAutomations(source, ret, map[string]map[string]string{source.ID: ids}, databaseIDs, true)
	return ret, ret.ValidateSubItems()
}

func newAttributeViewIdentityMap(source *av.AttributeView) map[string]string {
	ids := map[string]string{}
	for _, kv := range source.KeyValues {
		ids[kv.Key.ID] = ast.NewNodeID()
		for _, value := range kv.Values {
			ids[value.ID] = ast.NewNodeID()
			if value.BlockID != "" {
				ids[value.BlockID] = ast.NewNodeID()
			}
		}
	}
	stack := slices.Clone(source.Views)
	for len(stack) > 0 {
		view := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		ids[view.ID] = ast.NewNodeID()
		for _, layout := range view.TableLayouts() {
			if layout != nil {
				ids[layout.ID] = ast.NewNodeID()
			}
		}
		if view.Calendar != nil {
			ids[view.Calendar.ID] = ast.NewNodeID()
		}
		if view.Gallery != nil {
			ids[view.Gallery.ID] = ast.NewNodeID()
		}
		if view.Kanban != nil {
			ids[view.Kanban.ID] = ast.NewNodeID()
		}
		for _, rule := range view.ConditionalColors {
			if rule != nil {
				ids[rule.ID] = ast.NewNodeID()
			}
		}
		stack = append(stack, view.Groups...)
	}
	for _, template := range source.NewItemTemplates {
		if template != nil {
			ids[template.ID] = ast.NewNodeID()
		}
	}
	if source.Automations != nil {
		for _, rule := range source.Automations.Rules {
			if rule != nil {
				ids[rule.ID] = ast.NewNodeID()
			}
		}
	}
	delete(ids, "")
	return ids
}

func remapAttributeViewLocalIdentities(source *av.AttributeView, ids map[string]string) (*av.AttributeView, error) {
	data, err := attributeViewFieldJSON(source)
	if err != nil {
		return nil, err
	}
	var remap func(any, string) any
	identityMember := map[string]bool{"id": true, "keyID": true, "blockID": true, "column": true, "field": true, "relationKeyID": true, "parentKeyID": true, "childrenKeyID": true, "backKeyID": true, "dateKeyID": true, "colorKeyID": true, "coverFromAssetKeyID": true, "defaultTemplateID": true, "collectionRuleID": true, "keyIDs": true, "itemIds": true, "groupItemIds": true, "subItemsItemIds": true, "cardIds": true, "rowIds": true, "blockIDs": true}
	remap = func(value any, member string) any {
		switch typed := value.(type) {
		case string:
			if identityMember[member] && ids[typed] != "" {
				return ids[typed]
			}
		case []any:
			for i := range typed {
				typed[i] = remap(typed[i], member)
			}
		case map[string]any:
			result := map[string]any{}
			for key, child := range typed {
				if key == "automations" {
					result[key] = child
					continue
				}
				mappedKey := key
				if (member == "fieldValues" || member == "cardCoverPositions") && ids[key] != "" {
					mappedKey = ids[key]
				}
				if member == "block" && key == "id" {
					result[mappedKey] = child
				} else {
					result[mappedKey] = remap(child, key)
				}
			}
			return result
		}
		return value
	}
	encoded, err := json.Marshal(remap(data, ""))
	if err != nil {
		return nil, err
	}
	ret := &av.AttributeView{}
	if err = json.Unmarshal(encoded, ret); err != nil {
		return nil, err
	}
	for _, covers := range ret.CardCoverPositions {
		for source, position := range covers {
			if keyID := av.CardCoverSourceAssetKeyID(source); ids[keyID] != "" {
				delete(covers, source)
				covers[av.CardCoverSource(av.CoverFromAssetField, ids[keyID])] = position
			}
		}
	}
	return ret, nil
}

// 自动化的源字段始终属于触发库，目标字段及筛选属于动作选中的库，不能全局替换。
func remapAttributeViewAutomations(source, target *av.AttributeView, mappings map[string]map[string]string, databaseIDs map[string]string, pause bool) {
	if source.Automations == nil || target.Automations == nil {
		return
	}
	mapped := func(databaseID, id string) string {
		if replacement := mappings[databaseID][id]; replacement != "" {
			return replacement
		}
		return id
	}
	var filters func([]*av.ViewFilter, string)
	filters = func(values []*av.ViewFilter, databaseID string) {
		for _, filter := range values {
			if filter != nil {
				filter.Column = mapped(databaseID, filter.Column)
				filters(filter.Filters, databaseID)
			}
		}
	}
	for i, rule := range target.Automations.Rules {
		if rule == nil {
			continue
		}
		rule.ID, rule.KeyID = mapped(source.ID, rule.ID), mapped(source.ID, rule.KeyID)
		if pause {
			rule.Enabled = false
		}
		filters(rule.Conditions, source.ID)
		for j, action := range rule.Actions {
			if action == nil {
				continue
			}
			original := source.Automations.Rules[i].Actions[j]
			targetID := original.AvID
			if original.Target == "current" {
				targetID = source.ID
			} else if original.Target == "related" {
				if key, err := source.GetKey(original.RelationKeyID); err == nil && key.Relation != nil {
					targetID = key.Relation.AvID
				}
			}
			action.RelationKeyID = mapped(source.ID, original.RelationKeyID)
			if id := databaseIDs[action.AvID]; id != "" {
				action.AvID = id
			}
			filters(action.Filters, targetID)
			fields := map[string]*av.AutomationValue{}
			for keyID, value := range action.Fields {
				if value != nil {
					if value.Mode == "source" {
						value.KeyID = mapped(source.ID, value.KeyID)
					}
					if value.Mode == "template" {
						value.Template = av.RemapAutomationTemplate(value.Template, mappings[source.ID])
					}
				}
				fields[mapped(targetID, keyID)] = value
			}
			action.Fields = fields
		}
	}
}
