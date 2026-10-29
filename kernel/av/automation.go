// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
)

// AutomationConfig 随数据库保存，所有视图共享；缺省表示尚未配置自动化。
type AutomationConfig struct {
	Spec  int               `json:"spec"`
	Rules []*AutomationRule `json:"rules"`
}

type AutomationRule struct {
	ID              string                 `json:"id"`
	Name            string                 `json:"name"`
	Enabled         bool                   `json:"enabled"`
	Trigger         string                 `json:"trigger"` // added、changed 或 block
	KeyID           string                 `json:"keyID,omitempty"`
	Conditions      []*ViewFilter          `json:"conditions,omitempty"`
	Actions         []*AutomationAction    `json:"actions"`
	BlockSource     *AutomationBlockSource `json:"blockSource,omitempty"`
	TimeZone        string                 `json:"timeZone,omitempty"`
	NotifyOnSuccess *bool                  `json:"notifyOnSuccess,omitempty"`
}

// AutomationBlockSource 的范围取并集，各类条件取交集；文档深度缺省不限，0 仅自身。
// 所选文档自身缺省包含；显式关闭时跳过该文档及内部块，子文档仍按深度匹配。
type AutomationBlockSource struct {
	NotebookIDs              []string                    `json:"notebookIDs,omitempty"`
	DocumentIDs              []string                    `json:"documentIDs,omitempty"`
	DocumentDepth            *int                        `json:"documentDepth,omitempty"`
	IncludeSelectedDocuments *bool                       `json:"includeSelectedDocuments,omitempty"`
	Types                    []string                    `json:"types,omitempty"`
	Tags                     []string                    `json:"tags,omitempty"`
	ReferenceID              string                      `json:"referenceID,omitempty"`
	Attributes               []*AutomationBlockAttribute `json:"attributes,omitempty"`
	TagMatch                 string                      `json:"tagMatch,omitempty"`
	TagTarget                string                      `json:"tagTarget,omitempty"`
	AttributeMatch           string                      `json:"attributeMatch,omitempty"`
}

type AutomationBlockAttribute struct {
	Name         string `json:"name"`
	NameOperator string `json:"nameOperator,omitempty"`
	Operator     string `json:"operator"`
	Value        string `json:"value,omitempty"`
}

func (source *AutomationBlockSource) MatchesDocument(notebookID, documentID, documentPath string) bool {
	if source == nil {
		return false
	}
	if slices.Contains(source.NotebookIDs, notebookID) {
		return true
	}
	for _, id := range source.DocumentIDs {
		if documentID == id {
			if source.IncludeSelectedDocuments == nil || *source.IncludeSelectedDocuments {
				return true
			}
			continue
		}
		if _, suffix, found := strings.Cut(documentPath, "/"+id+"/"); found &&
			(source.DocumentDepth == nil || strings.Count(suffix, "/")+1 <= *source.DocumentDepth) {
			return true
		}
	}
	return false
}

// IsAutomationBlockType 校验主类型或主类型与子类型的组合，提示块允许自定义类型名称。
func IsAutomationBlockType(value string) bool {
	typ, sub, qualified := strings.Cut(value, ":")
	if !qualified {
		return slices.Contains([]string{"d", "h", "l", "i", "c", "m", "t", "b", "s", "p", "html",
			"query_embed", "av", "iframe", "widget", "tb", "video", "audio", "custom", "callout", "tabs", "tab",
			"mindmap", "mindmap_item"}, typ)
	}
	switch typ {
	case "h":
		return slices.Contains([]string{"h1", "h2", "h3", "h4", "h5", "h6"}, sub)
	case "l", "i":
		return slices.Contains([]string{"u", "o", "t"}, sub)
	case "callout":
		return sub != "" && sub == strings.TrimSpace(sub) && len(sub) <= 256 && !strings.ContainsAny(sub, "\r\n\t")
	}
	return false
}

// RequiredSpec 保留普通规则的版本，仅在使用新增语义时要求支持该语义的读取器。
func (rule *AutomationRule) RequiredSpec() int {
	ret := 1
	if rule.BlockSource != nil {
		if rule.BlockSource.ReferenceID != "" {
			return 8
		}
		if rule.BlockSource.IncludeSelectedDocuments != nil && !*rule.BlockSource.IncludeSelectedDocuments {
			return 7
		}
		for _, attr := range rule.BlockSource.Attributes {
			if attr != nil && attr.NameOperator != "" && attr.NameOperator != "equals" {
				return 6
			}
		}
		if rule.BlockSource.DocumentDepth != nil {
			return 5
		}
		if rule.BlockSource.TagTarget != "" {
			return 4
		}
		if rule.BlockSource.TagMatch == "or" || rule.BlockSource.AttributeMatch == "or" {
			return 3
		}
		for _, typ := range rule.BlockSource.Types {
			if strings.Contains(typ, ":") {
				return 3
			}
		}
	}
	for _, action := range rule.Actions {
		if action == nil {
			continue
		}
		for _, value := range action.Fields {
			if value != nil && value.Mode == "template" {
				ret = 2
			}
		}
	}
	return ret
}

func (config *AutomationConfig) ValidateSpec() error {
	if config == nil {
		return nil
	}
	if config.Spec < 1 || config.Spec > 8 {
		return fmt.Errorf("unsupported database automation specification [%d]", config.Spec)
	}
	for _, rule := range config.Rules {
		if rule != nil && rule.RequiredSpec() > config.Spec {
			return fmt.Errorf("automation rule requires specification [%d]", rule.RequiredSpec())
		}
	}
	return nil
}

type AutomationAction struct {
	Type          string                      `json:"type"`   // edit、add 或 collect
	Target        string                      `json:"target"` // current、related 或 filtered
	AvID          string                      `json:"avID,omitempty"`
	RelationKeyID string                      `json:"relationKeyID,omitempty"`
	Filters       []*ViewFilter               `json:"filters,omitempty"`
	Fields        map[string]*AutomationValue `json:"fields"`
}

type AutomationValue struct {
	Mode     string `json:"mode"` // static、source、currentTime、triggerItem 或 template
	KeyID    string `json:"keyID,omitempty"`
	Value    *Value `json:"value,omitempty"`
	Template string `json:"template,omitempty"`
}

// visitAutomationValues 将规则中的条件及固定值纳入资源、颜色和富文本的持久化遍历。
func (view *AttributeView) visitAutomationValues(visit func(*Value)) {
	if view.Automations == nil {
		return
	}
	for _, rule := range view.Automations.Rules {
		if rule == nil {
			continue
		}
		visitFilterValues(rule.Conditions, visit)
		for _, action := range rule.Actions {
			if action == nil {
				continue
			}
			visitFilterValues(action.Filters, visit)
			for _, field := range action.Fields {
				if field != nil {
					visit(field.Value)
				}
			}
		}
	}
}

// AutomationEditableKey 排除依赖渲染计算的字段，触发器只观察实际存储的值。
func AutomationEditableKey(typ KeyType) bool {
	return GetKeyCapability(typ).Editable
}

// MatchesAutomationFilters 按存储的关联 ID 判断空值，仅关键词条件需要读取关联条目的文本。
func (view *AttributeView) MatchesAutomationFilters(itemID string, filters []*ViewFilter,
	relationValues func(*Key, []string) ([]*Value, error)) (bool, error) {
	if len(filters) == 0 {
		return true, nil
	}
	columns := map[string]bool{}
	var collect func([]*ViewFilter)
	collect = func(filters []*ViewFilter) {
		for _, filter := range filters {
			if filter == nil {
				continue
			}
			if filter.IsGroup() {
				collect(filter.Filters)
				continue
			}
			keyword := filter.Operator != FilterOperatorIsEmpty && filter.Operator != FilterOperatorIsNotEmpty &&
				filter.Operator != FilterOperatorContainsAnyItem && filter.Operator != FilterOperatorDoesNotContainAnyItem
			columns[filter.Column] = columns[filter.Column] || keyword
		}
	}
	collect(filters)
	var values []*Value
	indexes := map[string]int{}
	for _, kv := range view.KeyValues {
		keyword, used := columns[kv.Key.ID]
		if !used {
			continue
		}
		indexes[kv.Key.ID] = len(values)
		value := kv.GetValue(itemID)
		if kv.Key.Type == KeyTypeRelation {
			if value == nil {
				value = &Value{Type: KeyTypeRelation, KeyID: kv.Key.ID, BlockID: itemID}
			}
			value = NormalizeAutomationValue(value)
			value.Relation.Contents = nil
			if keyword && len(value.Relation.BlockIDs) > 0 {
				if relationValues == nil {
					return false, fmt.Errorf("automation relation values are unavailable")
				}
				contents, err := relationValues(kv.Key, value.Relation.BlockIDs)
				if err != nil {
					return false, err
				}
				value.Relation.Contents = contents
			}
			// 缺失的关联条目仍保留 ID，空值判断不能依赖是否成功取得显示文本。
			for len(value.Relation.Contents) < len(value.Relation.BlockIDs) {
				value.Relation.Contents = append(value.Relation.Contents, &Value{Type: KeyTypeBlock, Block: &ValueBlock{}})
			}
		}
		values = append(values, value)
	}
	return evalNode(normalizeFiltersAsRoot(filters), values, indexes, view, itemID,
		map[string]*RollupRenderContext{}, map[string]*AttributeView{view.ID: view}), nil
}

func ValidateAutomationFilters(view *AttributeView, filters []*ViewFilter) error {
	if err := ValidateFilterDepth(filters); err != nil {
		return err
	}
	for _, filter := range filters {
		if filter == nil {
			return fmt.Errorf("invalid automation condition")
		}
		if filter.IsGroup() {
			if filter.Combination != FilterCombinationAnd && filter.Combination != FilterCombinationOr {
				return fmt.Errorf("invalid automation condition combination")
			}
			if err := ValidateAutomationFilters(view, filter.Filters); err != nil {
				return err
			}
			continue
		}
		key, err := view.GetKey(filter.Column)
		if err != nil || !AutomationEditableKey(key.Type) {
			return fmt.Errorf("automation condition field [%s] is unavailable", filter.Column)
		}
		if filter.Value == nil || filter.Value.Type != key.Type || filter.ValueSource != "" && filter.ValueSource != ValueSourceStored {
			return fmt.Errorf("invalid automation condition value [%s]", filter.Column)
		}
		if KeyTypeLocation == key.Type && (!IsFilterOperatorAllowed(key.Type, filter.Operator) ||
			filter.Operator != FilterOperatorIsEmpty && filter.Operator != FilterOperatorIsNotEmpty && nil == filter.Value.Text) {
			return fmt.Errorf("invalid automation location condition [%s]", filter.Column)
		}
		switch filter.Operator {
		case FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater, FilterOperatorIsGreaterOrEqual,
			FilterOperatorIsLess, FilterOperatorIsLessOrEqual, FilterOperatorContains, FilterOperatorDoesNotContain,
			FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem, FilterOperatorIsEmpty,
			FilterOperatorIsNotEmpty, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsTrue,
			FilterOperatorIsFalse, FilterOperatorIsBetween:
		default:
			return fmt.Errorf("invalid automation condition operator")
		}
	}
	return nil
}

// NormalizeAutomationValue 为未填值的字段补齐类型载荷，供筛选、比较和清空补丁复用。
func NormalizeAutomationValue(value *Value) *Value {
	if value == nil {
		return nil
	}
	value = value.Clone()
	switch value.Type {
	case KeyTypeBlock:
		if value.Block == nil {
			value.Block = &ValueBlock{}
		}
	case KeyTypeText:
		if value.Text == nil {
			value.Text = &ValueText{}
		}
	case KeyTypeNumber:
		if value.Number == nil {
			value.Number = &ValueNumber{}
		}
	case KeyTypeDate:
		if value.Date == nil {
			value.Date = &ValueDate{}
		}
	case KeyTypeURL:
		if value.URL == nil {
			value.URL = &ValueURL{}
		}
	case KeyTypeEmail:
		if value.Email == nil {
			value.Email = &ValueEmail{}
		}
	case KeyTypeLocation:
		if value.Location == nil {
			value.Location = &ValueLocation{}
		}
	case KeyTypePhone:
		if value.Phone == nil {
			value.Phone = &ValuePhone{}
		}
	case KeyTypeCheckbox:
		if value.Checkbox == nil {
			value.Checkbox = &ValueCheckbox{}
		}
	case KeyTypeRelation:
		if value.Relation == nil {
			value.Relation = &ValueRelation{}
		}
	}
	return value
}

// 复制数据库时保留规则供用户调整，并暂停执行，避免副本继续修改原数据库的关联记录。
func (view *AttributeView) remapAutomationKeys(originalID string, keyIDs map[string]string) {
	for _, row := range view.GetBlockKeyValues().Values {
		if row.Block != nil {
			row.Block.CollectionRuleID = ""
		}
	}
	if view.Automations == nil {
		return
	}
	var remapFilters func([]*ViewFilter)
	remapFilters = func(filters []*ViewFilter) {
		for _, filter := range filters {
			if filter != nil {
				if id := keyIDs[filter.Column]; id != "" {
					filter.Column = id
				}
				remapFilters(filter.Filters)
			}
		}
	}
	for _, rule := range view.Automations.Rules {
		if rule == nil {
			continue
		}
		rule.ID, rule.Enabled = ast.NewNodeID(), false
		rule.KeyID = keyIDs[rule.KeyID]
		remapFilters(rule.Conditions)
		for _, action := range rule.Actions {
			if action == nil {
				continue
			}
			action.RelationKeyID = keyIDs[action.RelationKeyID]
			for _, value := range action.Fields {
				if value != nil && value.Mode == "template" {
					value.Template = RemapAutomationTemplate(value.Template, keyIDs)
				}
				if value != nil && value.Mode == "source" {
					value.KeyID = keyIDs[value.KeyID]
				}
			}
			if action.Target == "current" || action.Target == "filtered" && action.AvID == originalID {
				action.AvID = view.ID
				if action.Type == "collect" {
					action.AvID = ""
				}
				remapFilters(action.Filters)
				fields := map[string]*AutomationValue{}
				for id, value := range action.Fields {
					if newID := keyIDs[id]; newID != "" {
						fields[newID] = value
					}
				}
				action.Fields = fields
			}
		}
	}
}
