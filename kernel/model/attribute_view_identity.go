package model

import (
	"slices"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func mappedAttributeViewIdentity(mappings map[string]map[string]string, databaseID, id string) string {
	if replacement := mappings[databaseID][id]; replacement != "" {
		return replacement
	}
	return id
}

// 关联值、候选筛选和汇总字段的身份属于目标库，按整个复制/导入集合解析。
// 未包含在集合中的库保留原身份，普通文字即使等于某个 ID 也不替换。
func remapAttributeViewReferences(source, target *av.AttributeView, sources map[string]*av.AttributeView, mappings map[string]map[string]string, databaseIDs map[string]string) {
	mapped := func(databaseID, id string) string { return mappedAttributeViewIdentity(mappings, databaseID, id) }
	related := func(databaseID, keyID string) string {
		if database := sources[databaseID]; database != nil {
			if key, err := database.GetKey(keyID); err == nil && key.Relation != nil {
				return key.Relation.AvID
			}
		}
		return ""
	}
	value := func(original, copied *av.Value, databaseID, keyID string) {
		if original == nil || copied == nil {
			return
		}
		copied.KeyID = mapped(databaseID, original.KeyID)
		if original.Relation != nil && copied.Relation != nil {
			targetID := related(databaseID, keyID)
			copied.Relation.BlockIDs = slices.Clone(original.Relation.BlockIDs)
			for i, id := range original.Relation.BlockIDs {
				copied.Relation.BlockIDs[i] = mapped(targetID, id)
			}
			copied.Relation.Contents = nil
		}
	}
	var filters func([]*av.ViewFilter, []*av.ViewFilter, string)
	filters = func(original, copied []*av.ViewFilter, databaseID string) {
		for i, filter := range original {
			if filter == nil || i >= len(copied) || copied[i] == nil {
				continue
			}
			copied[i].Column = mapped(databaseID, filter.Column)
			value(filter.Value, copied[i].Value, databaseID, filter.Column)
			filters(filter.Filters, copied[i].Filters, databaseID)
		}
	}
	key := func(original, copied *av.Key) {
		if original == nil || copied == nil {
			return
		}
		copied.Template = sql.RemapTemplateFieldIDs(original.Template, mappings[source.ID])
		copied.RenderTemplate = sql.RemapTemplateFieldIDs(original.RenderTemplate, mappings[source.ID])
		if original.Relation != nil {
			relation := original.Relation
			if newID := databaseIDs[relation.AvID]; newID != "" {
				copied.Relation.AvID = newID
			}
			copied.Relation.BackKeyID = mapped(relation.AvID, relation.BackKeyID)
			filters(relation.CandidateFilters, copied.Relation.CandidateFilters, relation.AvID)
		}
		if original.Rollup != nil {
			rollup := original.Rollup
			targetID := related(source.ID, rollup.RelationKeyID)
			copied.Rollup.RelationKeyID = mapped(source.ID, rollup.RelationKeyID)
			copied.Rollup.KeyID = mapped(targetID, rollup.KeyID)
			filters(rollup.Filters, copied.Rollup.Filters, targetID)
		}
	}
	for i, kv := range source.KeyValues {
		copied := target.KeyValues[i]
		key(kv.Key, copied.Key)
		for j, original := range kv.Values {
			value(original, copied.Values[j], source.ID, kv.Key.ID)
		}
	}
	for i, template := range source.NewItemTemplates {
		if template == nil {
			continue
		}
		for keyID, field := range template.FieldValues {
			copied := target.NewItemTemplates[i].FieldValues[mapped(source.ID, keyID)]
			if field != nil && copied != nil {
				value(field.Value, copied.Value, source.ID, keyID)
			}
		}
	}
	var views func([]*av.View, []*av.View)
	views = func(original, copied []*av.View) {
		for i, view := range original {
			key(view.GroupKey, copied[i].GroupKey)
			if view.GroupKey != nil {
				value(view.GroupVal, copied[i].GroupVal, source.ID, view.GroupKey.ID)
			}
			filters(view.Filters, copied[i].Filters, source.ID)
			for j, layout := range view.TableLayouts() {
				if layout != nil {
					filters(layout.Filters, copied[i].TableLayouts()[j].Filters, source.ID)
				}
			}
			if view.Gallery != nil {
				filters(view.Gallery.Filters, copied[i].Gallery.Filters, source.ID)
			}
			if view.Kanban != nil {
				filters(view.Kanban.Filters, copied[i].Kanban.Filters, source.ID)
			}
			for j, rule := range view.ConditionalColors {
				if rule != nil && copied[i].ConditionalColors[j] != nil {
					filters([]*av.ViewFilter{rule.Filter}, []*av.ViewFilter{copied[i].ConditionalColors[j].Filter}, source.ID)
				}
			}
			views(view.Groups, copied[i].Groups)
		}
	}
	views(source.Views, target.Views)
	if source.Automations == nil {
		return
	}
	for i, rule := range source.Automations.Rules {
		if rule == nil {
			continue
		}
		copied := target.Automations.Rules[i]
		filters(rule.Conditions, copied.Conditions, source.ID)
		for j, action := range rule.Actions {
			if action == nil {
				continue
			}
			targetID := action.AvID
			if action.Target == "current" {
				targetID = source.ID
			} else if action.Target == "related" {
				targetID = related(source.ID, action.RelationKeyID)
			}
			filters(action.Filters, copied.Actions[j].Filters, targetID)
			for keyID, field := range action.Fields {
				copiedField := copied.Actions[j].Fields[keyID]
				if field != nil && copiedField != nil {
					value(field.Value, copiedField.Value, targetID, keyID)
				}
			}
		}
	}
}
