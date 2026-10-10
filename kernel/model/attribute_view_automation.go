package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const maxAutomationOperations = 1000

type attributeViewAutomationSource struct {
	before  *av.AttributeView
	blockID string
	boxID   string
}

type attributeViewAutomationState struct {
	sources    []*attributeViewAutomationSource
	current    map[string]*av.AttributeView
	time       int64
	count      int
	recordUndo bool
	paused     []automationPausedRule
}

type automationUnavailableReference struct {
	kind, id string
	err      error
}

func (e *automationUnavailableReference) Error() string { return e.err.Error() }
func (e *automationUnavailableReference) Unwrap() error { return e.err }

type automationPausedRule struct {
	name      string
	reference *automationUnavailableReference
}

func unavailableAutomationReference(kind, id, message string) error {
	return &automationUnavailableReference{kind: kind, id: id, err: errors.New(message)}
}

// 提示仅在事务提交后发送，不把内部错误或认证信息作为界面文案。
func (paused automationPausedRule) message() string {
	detail := paused.name + " - " + util.I18nTerm(Conf.Lang, paused.reference.kind)
	if paused.reference.id != "" {
		detail += " [" + paused.reference.id + "]"
	}
	return strings.ReplaceAll(util.I18nTerm(Conf.Lang, "automationIncomplete"), "${1}", util.EscapeHTML(detail))
}

// 仅用户及 API 的条目写入产生触发事件，撤销重放只执行已记录的操作。
func (tx *Transaction) prepareAttributeViewAutomations() error {
	if !tx.fromAPI && !tx.isReplay {
		return nil
	}
	state := &attributeViewAutomationState{time: time.Now().UnixMilli(), recordUndo: len(tx.UndoOperations) > 0}
	seen := map[string]bool{}
	for _, op := range tx.DoOperations {
		if tx.isReplay {
			if op.attributeViewAutomation {
				tx.attributeViewAutomations = state
			}
			continue
		}
		switch op.Action {
		case "insertAttrViewBlock", "updateAttrViewCell", "updateAttrViewCells", "sortAttrViewRow", "duplicateAttrViewRow":
		default:
			continue
		}
		if op.AvID == "" || seen[op.AvID] {
			continue
		}
		view, err := avParseView(op.AvID, op.BlockID)
		if err != nil {
			return err
		}
		if view == nil {
			return av.ErrViewNotFound
		}
		seen[op.AvID] = true
		if view.Automations == nil {
			continue
		}
		for _, rule := range view.Automations.Rules {
			if rule != nil && rule.Enabled {
				before, cloneErr := cloneAttributeViewForFieldMutation(view)
				if cloneErr != nil {
					return cloneErr
				}
				_, boxID := av.FindAttributeViewPath(view.ID)
				state.sources = append(state.sources, &attributeViewAutomationSource{before, op.BlockID, boxID})
				tx.attributeViewAutomations = state
				break
			}
		}
	}
	if tx.attributeViewAutomations == nil {
		return nil
	}
	// 在任何操作执行前记录源数据库，覆盖同一事务中字段、分组及条目结构的联合修改。
	for _, op := range tx.DoOperations {
		if op.AvID == "" {
			continue
		}
		view, err := avParseView(op.AvID, op.BlockID)
		if err != nil {
			return err
		}
		if err = tx.rememberAutomationView(view, op.BlockID); err != nil {
			return err
		}
	}
	return nil
}

func (tx *Transaction) rememberAutomationView(view *av.AttributeView, blockID string) error {
	if tx == nil || (tx.attributeViewAutomations == nil && !tx.attributeViewItemCreation) {
		return nil
	}
	if view == nil {
		return av.ErrViewNotFound
	}
	_, boxID := av.FindAttributeViewPath(view.ID)
	if _, err := tx.readAttributeViewForMutation(view.ID, blockID, boxID); err != nil {
		return err
	}
	ids := []string{view.ID}
	for _, kv := range view.KeyValues {
		if kv.Key.Relation != nil && kv.Key.Relation.IsTwoWay && kv.Key.Relation.AvID != "" {
			ids = append(ids, kv.Key.Relation.AvID)
		}
	}
	for _, id := range ids {
		key := boxID + "/" + id
		if tx.attributeViewRollback.views[key] != nil {
			continue
		}
		original, err := tx.readAttributeViewForMutation(id, "", boxID)
		if id != view.ID && errors.Is(err, av.ErrViewNotFound) {
			original, err = tx.readAutomationTarget(id, boxID)
		}
		var unavailable *automationUnavailableReference
		if id != view.ID && errors.As(err, &unavailable) {
			// 已删除的关联目标没有可补偿的快照，失效规则由执行前的引用校验停用。
			continue
		}
		if err != nil {
			return err
		}
		original, err = cloneAttributeViewForFieldMutation(original)
		if err != nil {
			return err
		}
		tx.attributeViewRollback.views[key] = original
		tx.invalidateAttributeViewHistory(id)
	}
	return tx.rememberAttributeViewMutationTree(blockID)
}

// 文档仍由原事务提交；预先保存磁盘快照以补偿后续数据库动作或提交失败。
func (tx *Transaction) rememberAutomationTree(tree *parse.Tree) error {
	if (tx.attributeViewAutomations == nil && !tx.attributeViewItemCreation) || tx.attributeViewRollback == nil ||
		tx.attributeViewRollback.trees[tree.ID] != nil {
		return nil
	}
	original, err := filesys.LoadTree(tree.Box, tree.Path, tx.luteEngine)
	if err == nil {
		tx.attributeViewRollback.trees[tree.ID] = original
	}
	return err
}

func (tx *Transaction) runAttributeViewAutomations() error {
	state := tx.attributeViewAutomations
	if state == nil || tx.isReplay {
		return nil
	}
	// 所有触发条件使用源事务完成时的同一快照，自动写入不会串联触发其他规则。
	state.current = map[string]*av.AttributeView{}
	for _, source := range state.sources {
		current, err := tx.readAttributeViewForMutation(source.before.ID, source.blockID, source.boxID)
		if err != nil {
			return err
		}
		current, err = cloneAttributeViewForFieldMutation(current)
		if err != nil {
			return err
		}
		state.current[current.ID] = current
	}
	type triggeredRule struct {
		source  *attributeViewAutomationSource
		current *av.AttributeView
		rule    *av.AutomationRule
		itemID  string
	}
	var triggered []triggeredRule
	for _, source := range state.sources {
		current := state.current[source.before.ID]
		added, changed := automationChangedItems(source.before, current)
		relationValues := tx.automationRelationValues(source.boxID, state.current)
		paused := false
		for _, rule := range current.Automations.Rules {
			if rule == nil || !rule.Enabled {
				continue
			}
			validationErr := tx.validateAutomationRule(current, rule, source.boxID)
			var unavailable *automationUnavailableReference
			if errors.As(validationErr, &unavailable) {
				rule.Enabled = false
				paused = true
				state.paused = append(state.paused, automationPausedRule{rule.Name, unavailable})
				continue
			}
			for _, row := range current.GetBlockKeyValues().Values {
				matchesTrigger := rule.Trigger == "added" && added[row.BlockID] || rule.Trigger == "changed" && changed[rule.KeyID][row.BlockID]
				if !matchesTrigger {
					continue
				}
				if err := av.ValidateAutomationFilters(current, rule.Conditions); err != nil {
					return fmt.Errorf("automation [%s]: %w", rule.ID, err)
				}
				matches, err := current.MatchesAutomationFilters(row.BlockID, rule.Conditions, relationValues)
				if err != nil {
					return fmt.Errorf("automation [%s]: %w", rule.ID, err)
				}
				if !matches {
					continue
				}
				if validationErr != nil {
					return fmt.Errorf("automation [%s]: %w", rule.ID, validationErr)
				}
				triggered = append(triggered, triggeredRule{source, current, rule, row.BlockID})
			}
		}
		if paused {
			// 仅改变启用状态，保留失效引用供用户修复；失败时随源数据库快照一起恢复。
			if err := avSaveView(current, source.blockID); err != nil {
				return err
			}
			ReloadAttrView(current.ID)
		}
	}
	// 先确定全部触发条件，关联关键词也不会读到前一自动动作修改后的标题。
	for _, entry := range triggered {
		for _, action := range entry.rule.Actions {
			if err := tx.runAutomationAction(entry.source, entry.current, entry.itemID, action); err != nil {
				return fmt.Errorf("automation [%s]: %w", entry.rule.ID, err)
			}
		}
	}
	return nil
}

// 每个字段的值只索引一次，各规则复用变更集合，避免逐行反复扫描整列。
func automationChangedItems(before, current *av.AttributeView) (added map[string]bool, changed map[string]map[string]bool) {
	added, changed = map[string]bool{}, map[string]map[string]bool{"": {}}
	index := func(values []*av.Value) map[string]*av.Value {
		ret := make(map[string]*av.Value, len(values))
		for _, value := range values {
			ret[value.BlockID] = value
		}
		return ret
	}
	oldRows := index(before.GetBlockKeyValues().Values)
	for _, row := range current.GetBlockKeyValues().Values {
		if oldRows[row.BlockID] == nil {
			added[row.BlockID] = true
		}
	}
	watched := map[string]bool{}
	all := false
	for _, rule := range before.Automations.Rules {
		if rule != nil && rule.Enabled && rule.Trigger == "changed" {
			watched[rule.KeyID] = true
			all = all || rule.KeyID == ""
		}
	}
	previous := map[string]*av.KeyValues{}
	for _, kv := range before.KeyValues {
		previous[kv.Key.ID] = kv
	}
	for _, kv := range current.KeyValues {
		if !av.AutomationEditableKey(kv.Key.Type) || !all && !watched[kv.Key.ID] {
			continue
		}
		oldValues := map[string]*av.Value{}
		if old := previous[kv.Key.ID]; old != nil {
			oldValues = index(old.Values)
		}
		newValues := index(kv.Values)
		for _, row := range current.GetBlockKeyValues().Values {
			if added[row.BlockID] || equalAutomationValues(oldValues[row.BlockID], newValues[row.BlockID]) {
				continue
			}
			if changed[kv.Key.ID] == nil {
				changed[kv.Key.ID] = map[string]bool{}
			}
			changed[kv.Key.ID][row.BlockID], changed[""][row.BlockID] = true, true
		}
	}
	return
}

// 关联关键词在事务的加密边界内读取主键文本，读取失败必须中止事务。
func (tx *Transaction) automationRelationValues(boxID string, snapshots map[string]*av.AttributeView) func(*av.Key, []string) ([]*av.Value, error) {
	indexes := map[string]map[string]*av.Value{}
	return func(key *av.Key, ids []string) ([]*av.Value, error) {
		if key.Relation == nil || key.Relation.AvID == "" {
			return nil, fmt.Errorf("automation relation field [%s] is unavailable", key.ID)
		}
		id := key.Relation.AvID
		values := indexes[id]
		if values == nil {
			view, err := tx.readAttributeViewForMutation(id, "", boxID)
			if err != nil {
				return nil, err
			}
			if snapshot := snapshots[id]; snapshot != nil {
				view = snapshot
			}
			values = map[string]*av.Value{}
			for _, value := range view.GetBlockKeyValues().Values {
				values[value.BlockID] = value.Clone()
			}
			indexes[id] = values
		}
		ret := make([]*av.Value, 0, len(ids))
		for _, id := range ids {
			if value := values[id]; value != nil {
				ret = append(ret, value)
			}
		}
		return ret, nil
	}
}

func equalAutomationValues(left, right *av.Value) bool {
	if reflect.DeepEqual(left, right) {
		return true
	}
	normalize := func(value *av.Value) any {
		value = av.NormalizeAutomationValue(value)
		if value == nil {
			return nil
		}
		if value.Type == av.KeyTypeRelation {
			if len(value.Relation.BlockIDs) == 0 {
				return nil
			}
		} else if value.IsEmpty() || value.Type == av.KeyTypeCheckbox && !value.Checkbox.Checked {
			return nil
		}
		value = value.Clone()
		if value.Type == av.KeyTypeLocation {
			return value.String(false)
		}
		value.ID, value.KeyID, value.BlockID = "", "", ""
		value.CreatedAt, value.UpdatedAt = 0, 0
		value.RenderedContent, value.HasRenderTemplate = "", false
		data, _ := json.Marshal(value)
		var result map[string]any
		_ = json.Unmarshal(data, &result)
		for _, field := range []string{"block", "text", "number", "date", "relation"} {
			if nested, ok := result[field].(map[string]any); ok {
				for _, property := range []string{"created", "updated", "formattedContent", "contents"} {
					delete(nested, property)
				}
			}
		}
		return result
	}
	return reflect.DeepEqual(normalize(left), normalize(right))
}

func (tx *Transaction) automationTarget(source *av.AttributeView, action *av.AutomationAction, boxID string) (*av.AttributeView, error) {
	id := action.AvID
	if action.Target == "current" {
		id = source.ID
	} else if action.Target == "related" {
		key, err := source.GetKey(action.RelationKeyID)
		if err != nil || key.Relation == nil || key.Relation.AvID == "" {
			return nil, unavailableAutomationReference("fields", action.RelationKeyID,
				fmt.Sprintf("automation relation field [%s] is unavailable", action.RelationKeyID))
		}
		id = key.Relation.AvID
	}
	if !ast.IsNodeIDPattern(id) {
		return nil, fmt.Errorf("invalid automation target database")
	}
	return tx.readAutomationTarget(id, boxID)
}

// 仅确认文件不存在时将目标视为失效引用，访问失败和读取竞态仍交由事务处理。
func (tx *Transaction) readAutomationTarget(id, boxID string) (*av.AttributeView, error) {
	target, err := tx.readAttributeViewForMutation(id, "", boxID)
	if errors.Is(err, av.ErrViewNotFound) {
		_, statErr := os.Stat(filepath.Join(util.DataDir, boxID, "storage", "av", id+".json"))
		if os.IsNotExist(statErr) {
			err = &automationUnavailableReference{kind: "database", id: id, err: err}
		} else if statErr != nil {
			err = statErr
		}
	}
	return target, err
}

// 在已认证的数据库定义上识别失效字段及关联目标；其他读取和配置错误仍返回给事务。
func (tx *Transaction) validateAutomationFilters(view *av.AttributeView, filters []*av.ViewFilter, boxID string) error {
	if err := av.ValidateFilterDepth(filters); err != nil {
		return err
	}
	for _, filter := range filters {
		if filter == nil {
			continue
		}
		if filter.IsGroup() {
			if err := tx.validateAutomationFilters(view, filter.Filters, boxID); err != nil {
				return err
			}
			continue
		}
		key, err := view.GetKey(filter.Column)
		if err != nil || !av.AutomationEditableKey(key.Type) || filter.Value != nil && filter.Value.Type != key.Type {
			return unavailableAutomationReference("fields", filter.Column,
				fmt.Sprintf("automation condition field [%s] is unavailable", filter.Column))
		}
		if key.Type == av.KeyTypeRelation {
			if _, err = tx.automationTarget(view, &av.AutomationAction{Target: "related", RelationKeyID: key.ID}, boxID); err != nil {
				return err
			}
		}
	}
	return av.ValidateAutomationFilters(view, filters)
}

func (tx *Transaction) validateAutomationRule(source *av.AttributeView, rule *av.AutomationRule, boxID string) error {
	if rule.Trigger != "added" && rule.Trigger != "changed" || len(rule.Actions) == 0 || len(rule.Actions) > 20 {
		return fmt.Errorf("invalid automation trigger or actions")
	}
	if rule.KeyID != "" {
		key, err := source.GetKey(rule.KeyID)
		if err != nil || !av.AutomationEditableKey(key.Type) {
			return unavailableAutomationReference("fields", rule.KeyID,
				fmt.Sprintf("automation trigger field [%s] is unavailable", rule.KeyID))
		}
	}
	if err := tx.validateAutomationFilters(source, rule.Conditions, boxID); err != nil {
		return err
	}
	for _, action := range rule.Actions {
		if action == nil || action.Type != "add" && action.Type != "edit" ||
			action.Target != "current" && action.Target != "related" && action.Target != "filtered" || len(action.Fields) == 0 {
			return fmt.Errorf("invalid automation action")
		}
		target, err := tx.automationTarget(source, action, boxID)
		if err != nil {
			return err
		}
		if err = tx.validateAutomationFilters(target, action.Filters, boxID); err != nil {
			return err
		}
		for keyID, field := range action.Fields {
			if field == nil {
				return fmt.Errorf("invalid automation action value [%s]", keyID)
			}
			key, keyErr := target.GetKey(keyID)
			if keyErr != nil || !av.AutomationEditableKey(key.Type) {
				return unavailableAutomationReference("fields", keyID,
					fmt.Sprintf("automation action field [%s] is unavailable", keyID))
			}
			switch field.Mode {
			case "currentTime":
				if key.Type != av.KeyTypeDate {
					return unavailableAutomationReference("fields", keyID, "automation trigger time requires a date field")
				}
			case "triggerItem":
				if key.Type != av.KeyTypeRelation || key.Relation == nil || key.Relation.AvID != source.ID {
					return unavailableAutomationReference("fields", keyID, "automation trigger item requires a relation to the source database")
				}
			case "static":
				if field.Value == nil {
					return fmt.Errorf("invalid automation static value [%s]", keyID)
				}
				if field.Value.Type != key.Type {
					return unavailableAutomationReference("fields", keyID, fmt.Sprintf("automation field value type mismatch [%s]", keyID))
				}
			case "source":
				sourceKey, sourceErr := source.GetKey(field.KeyID)
				if sourceErr != nil || sourceKey.Type != key.Type && !(sourceKey.Type == av.KeyTypeBlock && key.Type == av.KeyTypeText) {
					return unavailableAutomationReference("fields", field.KeyID, fmt.Sprintf("automation source field type mismatch [%s]", field.KeyID))
				}
				if key.Type == av.KeyTypeRelation && (sourceKey.Relation == nil || key.Relation == nil || sourceKey.Relation.AvID != key.Relation.AvID) {
					return unavailableAutomationReference("fields", keyID, fmt.Sprintf("automation relation target mismatch [%s]", keyID))
				}
			default:
				return fmt.Errorf("invalid automation value mode")
			}
		}
	}
	return nil
}

func (tx *Transaction) runAutomationAction(source *attributeViewAutomationSource, current *av.AttributeView,
	itemID string, action *av.AutomationAction) error {
	target, err := tx.automationTarget(current, action, source.boxID)
	if err != nil {
		return err
	}
	blockID := ""
	if target.ID == current.ID {
		blockID = source.blockID
	} else {
		rels, readErr := av.GetBlockRelsByAVIDs([]string{target.ID})
		if readErr != nil {
			return readErr
		}
		if len(rels[target.ID]) > 0 {
			blockID = rels[target.ID][0]
		}
	}
	if err = tx.rememberAutomationView(target, blockID); err != nil {
		return err
	}
	var ids []string
	if action.Type == "add" {
		id := ast.NewNodeID()
		op := &Operation{Action: "insertAttrViewBlock", AvID: target.ID, BlockID: blockID, IgnoreDefaultFill: true,
			Srcs: []map[string]any{{"id": id, "itemID": id, "isDetached": true, "content": ""}}}
		inverse := &Operation{Action: "removeAttrViewBlock", AvID: target.ID, BlockID: blockID, SrcIDs: []string{id}}
		if err = tx.applyAutomationOperation(op, inverse); err != nil {
			return err
		}
		ids = []string{id}
	} else {
		switch action.Target {
		case "current":
			ids = []string{itemID}
		case "related":
			// 前一动作可能新增了双向关联，目标选择读取本事务的最新值。
			latest, readErr := tx.readAttributeViewForMutation(current.ID, source.blockID, source.boxID)
			if readErr != nil {
				return readErr
			}
			if value := latest.GetValue(action.RelationKeyID, itemID); value != nil && value.Relation != nil {
				ids = append(ids, value.Relation.BlockIDs...)
			}
		case "filtered":
			for _, row := range target.GetBlockKeyValues().Values {
				ids = append(ids, row.BlockID)
			}
		}
	}
	keys := make([]string, 0, len(action.Fields))
	for keyID := range action.Fields {
		keys = append(keys, keyID)
	}
	sort.Strings(keys)
	ids = slices.Compact(ids)
	relationValues := tx.automationRelationValues(source.boxID, nil)
	for _, id := range ids {
		target, err = tx.readAttributeViewForMutation(target.ID, blockID, source.boxID)
		if err != nil {
			return err
		}
		if target.GetBlockValue(id) == nil {
			return av.ErrItemNotFound
		}
		if action.Type != "add" {
			matches, filterErr := target.MatchesAutomationFilters(id, action.Filters, relationValues)
			if filterErr != nil {
				return filterErr
			}
			if !matches {
				continue
			}
		}
		for _, keyID := range keys {
			key, _ := target.GetKey(keyID)
			value, valueErr := tx.resolveAutomationValue(current, itemID, key, action.Fields[keyID])
			if valueErr != nil {
				return valueErr
			}
			previous := target.GetValue(keyID, id)
			if previous == nil {
				previous = &av.Value{Type: key.Type}
			} else {
				previous = previous.Clone()
			}
			if key.Type == av.KeyTypeBlock {
				// 自动化只修改主键文本，保留条目的绑定、图标和引用方式。
				content := ""
				if value.Block != nil {
					content = value.Block.Content
				}
				value = previous.Clone()
				value.Block.Content = content
			}
			if equalAutomationValues(previous, value) {
				continue
			}
			op := &Operation{Action: "updateAttrViewCell", AvID: target.ID, BlockID: blockID, KeyID: keyID, RowID: id,
				Data: automationValuePatch(value)}
			inverse := &Operation{Action: op.Action, AvID: op.AvID, BlockID: blockID, KeyID: keyID, RowID: id,
				Data: automationValuePatch(previous)}
			if err = tx.applyAutomationOperation(op, inverse); err != nil {
				return err
			}
		}
	}
	return nil
}

// 完整字段补丁显式保留 null，清空字段时不与现有值意外合并。
func automationValuePatch(value *av.Value) map[string]any {
	data, _ := json.Marshal(av.NormalizeAutomationValue(value))
	ret := map[string]any{}
	_ = json.Unmarshal(data, &ret)
	field := string(value.Type)
	if field == "select" {
		field = "mSelect"
	}
	if _, ok := ret[field]; !ok {
		ret[field] = nil
	}
	if av.KeyTypeLocation == value.Type {
		location := value.Location
		if nil == location {
			location = &av.ValueLocation{}
		}
		ret[field] = map[string]any{"name": location.Name, "latitude": location.Latitude,
			"longitude":     location.Longitude,
			"originalInput": location.OriginalInput}
	}
	for _, key := range []string{"id", "keyID", "blockID", "createdAt", "updatedAt", "renderedContent", "hasRenderTemplate"} {
		delete(ret, key)
	}
	return ret
}

func (tx *Transaction) resolveAutomationValue(source *av.AttributeView, itemID string, key *av.Key,
	field *av.AutomationValue) (*av.Value, error) {
	var value *av.Value
	switch field.Mode {
	case "currentTime":
		value = &av.Value{Type: av.KeyTypeDate, Date: &av.ValueDate{Content: tx.attributeViewAutomations.time, IsNotEmpty: true}}
	case "triggerItem":
		value = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{itemID}}}
	case "source":
		value = source.GetValue(field.KeyID, itemID)
		if value != nil {
			value = value.Clone()
			if key.Type == av.KeyTypeText && value.Type == av.KeyTypeBlock {
				value = &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: value.Block.Content}}
			}
		}
	case "static":
		value = field.Value.Clone()
	}
	if value == nil {
		value = &av.Value{Type: key.Type}
	}
	if value.Relation != nil {
		value.Relation.Contents = nil
	}
	return av.NormalizeAutomationValue(value), nil
}

func (tx *Transaction) applyAutomationOperation(op, inverse *Operation) error {
	state := tx.attributeViewAutomations
	state.count++
	if state.count > maxAutomationOperations {
		return fmt.Errorf("automation exceeds %d operations per transaction", maxAutomationOperations)
	}
	op.attributeViewAutomation, inverse.attributeViewAutomation = true, true
	tx.DoOperations = append(tx.DoOperations, op)
	if state.recordUndo {
		tx.UndoOperations = append([]*Operation{inverse}, tx.UndoOperations...)
	}
	var err *TxErr
	switch op.Action {
	case "insertAttrViewBlock":
		err = tx.doInsertAttrViewBlock(op)
	case "updateAttrViewCell":
		err = tx.doUpdateAttrViewCell(op)
	}
	if err != nil {
		return err
	}
	ReloadAttrView(op.AvID)
	return nil
}

func (tx *Transaction) doSetAttrViewAutomations(op *Operation) *TxErr {
	fail := func(err error) *TxErr {
		return &TxErr{code: TxErrHandleAttributeView, id: op.AvID, msg: err.Error()}
	}
	view, err := avParseView(op.AvID, op.BlockID)
	if err != nil {
		return fail(err)
	}
	if view == nil {
		return fail(av.ErrViewNotFound)
	}
	data, err := json.Marshal(op.Data)
	if err != nil {
		return fail(err)
	}
	var config av.AutomationConfig
	if err = json.Unmarshal(data, &config); err != nil {
		return fail(err)
	}
	if config.Spec != 1 || len(config.Rules) > 100 {
		return fail(fmt.Errorf("unsupported automation configuration"))
	}
	if err = (&av.AttributeView{Automations: &config}).NormalizeLocations(); nil != err {
		return fail(err)
	}
	_, boxID := av.FindAttributeViewPath(view.ID)
	seen := map[string]bool{}
	for _, rule := range config.Rules {
		if rule == nil || !ast.IsNodeIDPattern(rule.ID) || seen[rule.ID] || strings.TrimSpace(rule.Name) == "" {
			return fail(fmt.Errorf("invalid automation rule"))
		}
		seen[rule.ID] = true
		if rule.Enabled {
			if err = tx.validateAutomationRule(view, rule, boxID); err != nil {
				return fail(err)
			}
		}
	}
	if _, err = tx.readAttributeViewForMutation(view.ID, op.BlockID, boxID); err != nil {
		return fail(err)
	}
	before, err := cloneAttributeViewForFieldMutation(view)
	if err != nil {
		return fail(err)
	}
	if tx.attributeViewRollback.views[boxID+"/"+view.ID] == nil {
		tx.attributeViewRollback.views[boxID+"/"+view.ID] = before
	}
	if err = tx.rememberAttributeViewMutationTree(op.BlockID); err != nil {
		return fail(err)
	}
	view.Automations = &config
	if err = avSaveView(view, op.BlockID); err != nil {
		return fail(err)
	}
	tx.invalidateAttributeViewHistory(view.ID)
	ReloadAttrView(view.ID)
	return nil
}

// PerformAttributeViewOperations 使普通数据库 API 写入与编辑器共享自动化事务，保留 API 不生成撤销记录的约定。
func PerformAttributeViewOperations(operations []*Operation) error {
	tx := &Transaction{DoOperations: operations, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		return err
	}
	return nil
}
