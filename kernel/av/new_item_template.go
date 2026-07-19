// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package av

import (
	"errors"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
)

// SetNewItemTemplates 校验并替换数据库的新增条目模板配置。
func (av *AttributeView) SetNewItemTemplates(config *NewItemTemplatesConfig) error {
	if nil == config {
		return errors.New("new item templates config is nil")
	}

	templates := make([]*NewItemTemplate, 0, len(config.Templates))
	templateIDs := map[string]bool{}
	defaultTemplateID := config.DefaultTemplateID
	for _, itemTemplate := range config.Templates {
		if nil == itemTemplate {
			continue
		}
		itemTemplate = cloneNewItemTemplate(itemTemplate)
		if nil == itemTemplate {
			return errors.New("clone new item template failed")
		}
		itemTemplate.Name = strings.TrimSpace(itemTemplate.Name)
		itemTemplate.Icon = strings.TrimSpace(itemTemplate.Icon)
		if "" == itemTemplate.Name {
			return errors.New("new item template name is empty")
		}
		if !ast.IsNodeIDPattern(itemTemplate.ID) {
			return fmt.Errorf("invalid new item template id [%s]", itemTemplate.ID)
		}
		if templateIDs[itemTemplate.ID] {
			return fmt.Errorf("duplicated new item template id [%s]", itemTemplate.ID)
		}
		templateIDs[itemTemplate.ID] = true
		if NewItemTargetDetached != itemTemplate.TargetType && NewItemTargetDocument != itemTemplate.TargetType {
			return fmt.Errorf("invalid new item template target type [%s]", itemTemplate.TargetType)
		}
		if NewItemTargetDocument != itemTemplate.TargetType {
			itemTemplate.Icon = ""
		}
		itemTemplate.ContentTemplatePath = strings.TrimSpace(itemTemplate.ContentTemplatePath)
		if nil != itemTemplate.SaveLocation {
			itemTemplate.SaveLocation.BoxID = strings.TrimSpace(itemTemplate.SaveLocation.BoxID)
			itemTemplate.SaveLocation.PathTemplate = strings.TrimSpace(itemTemplate.SaveLocation.PathTemplate)
		}
		if err := av.normalizeNewItemTemplateFieldValues(itemTemplate); nil != err {
			return err
		}
		templates = append(templates, itemTemplate)
	}
	if "" != defaultTemplateID && !templateIDs[defaultTemplateID] {
		return fmt.Errorf("default new item template [%s] not found", defaultTemplateID)
	}
	if 0 == len(templates) {
		av.NewItemTemplates = nil
	} else {
		av.NewItemTemplates = templates
	}
	av.DefaultTemplateID = defaultTemplateID
	return nil
}

// GetNewItemTemplate 根据 ID 获取新增条目模板。
func (av *AttributeView) GetNewItemTemplate(id string) *NewItemTemplate {
	for _, itemTemplate := range av.NewItemTemplates {
		if nil != itemTemplate && itemTemplate.ID == id {
			return itemTemplate
		}
	}
	return nil
}

// RemoveNewItemTemplateFieldValue 删除所有新增条目模板中指定字段的配置。
func (av *AttributeView) RemoveNewItemTemplateFieldValue(keyID string) (changed bool) {
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate || nil == itemTemplate.FieldValues {
			continue
		}
		if _, ok := itemTemplate.FieldValues[keyID]; ok {
			delete(itemTemplate.FieldValues, keyID)
			changed = true
		}
		if 0 == len(itemTemplate.FieldValues) {
			itemTemplate.FieldValues = nil
		}
	}
	return
}

// RemoveNewItemTemplateSelectOption 删除所有新增条目模板中指定字段的候选值。
func (av *AttributeView) RemoveNewItemTemplateSelectOption(keyID, optionName string) (changed bool) {
	return av.updateNewItemTemplateSelectOption(keyID, optionName, "", "", true)
}

// RenameNewItemTemplateSelectOption 同步修改所有新增条目模板中的候选值。
func (av *AttributeView) RenameNewItemTemplateSelectOption(keyID, oldName, newName, newColor string) (changed bool) {
	return av.updateNewItemTemplateSelectOption(keyID, oldName, newName, newColor, false)
}

func (av *AttributeView) updateNewItemTemplateSelectOption(keyID, oldName, newName, newColor string, remove bool) (changed bool) {
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate || nil == itemTemplate.FieldValues {
			continue
		}
		fieldValue := itemTemplate.FieldValues[keyID]
		if nil == fieldValue || NewItemFieldValueStatic != fieldValue.Mode || nil == fieldValue.Value {
			continue
		}
		value := fieldValue.Value
		if KeyTypeSelect != value.Type && KeyTypeMSelect != value.Type {
			continue
		}

		selections := make([]*ValueSelect, 0, len(value.MSelect))
		selectedNames := map[string]bool{}
		for _, selection := range value.MSelect {
			if nil == selection {
				continue
			}
			if oldName == selection.Content {
				changed = true
				if remove {
					continue
				}
				selection.Content = newName
				selection.Color = newColor
			}
			if "" == selection.Content || selectedNames[selection.Content] {
				continue
			}
			selectedNames[selection.Content] = true
			selections = append(selections, selection)
		}
		value.MSelect = selections
		if 0 == len(selections) {
			delete(itemTemplate.FieldValues, keyID)
		}
		if 0 == len(itemTemplate.FieldValues) {
			itemTemplate.FieldValues = nil
		}
	}
	return
}

// RemoveNewItemTemplateRelationItems 删除所有新增条目模板中指向指定数据库条目的关联值。
func (av *AttributeView) RemoveNewItemTemplateRelationItems(targetAvID string, itemIDs []string) (changed bool) {
	if 0 == len(itemIDs) {
		return
	}
	removedIDs := map[string]bool{}
	for _, itemID := range itemIDs {
		removedIDs[itemID] = true
	}
	relationKeyIDs := map[string]bool{}
	for _, keyValues := range av.KeyValues {
		if nil != keyValues && nil != keyValues.Key && KeyTypeRelation == keyValues.Key.Type &&
			nil != keyValues.Key.Relation && targetAvID == keyValues.Key.Relation.AvID {
			relationKeyIDs[keyValues.Key.ID] = true
		}
	}

	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate || nil == itemTemplate.FieldValues {
			continue
		}
		for keyID := range relationKeyIDs {
			fieldValue := itemTemplate.FieldValues[keyID]
			if nil == fieldValue || NewItemFieldValueStatic != fieldValue.Mode || nil == fieldValue.Value ||
				nil == fieldValue.Value.Relation {
				continue
			}
			blockIDs := fieldValue.Value.Relation.BlockIDs[:0]
			for _, blockID := range fieldValue.Value.Relation.BlockIDs {
				if removedIDs[blockID] {
					changed = true
					continue
				}
				blockIDs = append(blockIDs, blockID)
			}
			fieldValue.Value.Relation.BlockIDs = blockIDs
			if 0 == len(blockIDs) {
				delete(itemTemplate.FieldValues, keyID)
			}
		}
		if 0 == len(itemTemplate.FieldValues) {
			itemTemplate.FieldValues = nil
		}
	}
	return
}

// PruneInvalidNewItemTemplateFieldValues 清理因字段结构或候选值变化而失效的模板字段值。
func (av *AttributeView) PruneInvalidNewItemTemplateFieldValues() {
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate || nil == itemTemplate.FieldValues {
			continue
		}
		for keyID, fieldValue := range itemTemplate.FieldValues {
			key, err := av.GetKey(keyID)
			if nil != err || nil == key || !isNewItemTemplateEditableKeyType(key.Type) || nil == fieldValue {
				delete(itemTemplate.FieldValues, keyID)
				continue
			}
			if "" == fieldValue.Mode {
				fieldValue.Mode = NewItemFieldValueStatic
			}
			if NewItemFieldValueCurrentTime == fieldValue.Mode {
				if KeyTypeDate != key.Type {
					delete(itemTemplate.FieldValues, keyID)
				} else {
					fieldValue.Value = nil
				}
				continue
			}
			if NewItemFieldValueStatic != fieldValue.Mode || nil == fieldValue.Value {
				delete(itemTemplate.FieldValues, keyID)
				continue
			}
			normalized, normalizeErr := normalizeNewItemTemplateValue(fieldValue.Value, key)
			if nil != normalizeErr {
				delete(itemTemplate.FieldValues, keyID)
				continue
			}
			if KeyTypeSelect == key.Type || KeyTypeMSelect == key.Type {
				selections := normalized.MSelect[:0]
				for _, selection := range normalized.MSelect {
					if nil != selection && nil != key.GetOption(selection.Content) {
						selections = append(selections, selection)
					}
				}
				normalized.MSelect = selections
				if 0 == len(selections) {
					delete(itemTemplate.FieldValues, keyID)
					continue
				}
			}
			fieldValue.Value = normalized
		}
		if 0 == len(itemTemplate.FieldValues) {
			itemTemplate.FieldValues = nil
		}
	}
}

func (av *AttributeView) normalizeNewItemTemplateFieldValues(itemTemplate *NewItemTemplate) error {
	if 0 == len(itemTemplate.FieldValues) {
		itemTemplate.FieldValues = nil
		return nil
	}

	fieldValues := map[string]*NewItemFieldValue{}
	for keyID, fieldValue := range itemTemplate.FieldValues {
		key, err := av.GetKey(keyID)
		if nil != err || nil == key {
			return fmt.Errorf("new item template field [%s] not found", keyID)
		}
		if !isNewItemTemplateEditableKeyType(key.Type) {
			return fmt.Errorf("new item template field [%s] type [%s] is not editable", keyID, key.Type)
		}
		if nil == fieldValue {
			continue
		}
		if "" == fieldValue.Mode {
			fieldValue.Mode = NewItemFieldValueStatic
		}
		switch fieldValue.Mode {
		case NewItemFieldValueCurrentTime:
			if KeyTypeDate != key.Type {
				return fmt.Errorf("new item template field [%s] current time mode requires date type", keyID)
			}
			fieldValue.Value = nil
		case NewItemFieldValueStatic:
			if nil == fieldValue.Value {
				continue
			}
			fieldValue.Value, err = normalizeNewItemTemplateValue(fieldValue.Value, key)
			if nil != err {
				return fmt.Errorf("new item template field [%s] value is invalid: %w", keyID, err)
			}
		default:
			return fmt.Errorf("invalid new item template field value mode [%s]", fieldValue.Mode)
		}
		fieldValues[keyID] = fieldValue
	}
	if 0 == len(fieldValues) {
		itemTemplate.FieldValues = nil
	} else {
		itemTemplate.FieldValues = fieldValues
	}
	return nil
}

func normalizeNewItemTemplateValue(value *Value, key *Key) (*Value, error) {
	value = value.Clone()
	switch key.Type {
	case KeyTypeText:
		if nil == value.Text {
			return nil, errors.New("text value is missing")
		}
		value.Number, value.Date, value.MSelect, value.URL, value.Email, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeNumber:
		if nil == value.Number {
			return nil, errors.New("number value is missing")
		}
		value.Text, value.Date, value.MSelect, value.URL, value.Email, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeDate:
		if nil == value.Date {
			return nil, errors.New("date value is missing")
		}
		value.Text, value.Number, value.MSelect, value.URL, value.Email, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeSelect, KeyTypeMSelect:
		var selections []*ValueSelect
		for _, selection := range value.MSelect {
			if nil != selection && "" != strings.TrimSpace(selection.Content) {
				selections = append(selections, selection)
			}
		}
		if KeyTypeSelect == key.Type && 1 < len(selections) {
			selections = selections[:1]
		}
		value.MSelect = selections
		value.Text, value.Number, value.Date, value.URL, value.Email, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeURL:
		if nil == value.URL {
			return nil, errors.New("URL value is missing")
		}
		value.Text, value.Number, value.Date, value.MSelect, value.Email, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeEmail:
		if nil == value.Email {
			return nil, errors.New("email value is missing")
		}
		value.Text, value.Number, value.Date, value.MSelect, value.URL, value.Phone, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypePhone:
		if nil == value.Phone {
			return nil, errors.New("phone value is missing")
		}
		value.Text, value.Number, value.Date, value.MSelect, value.URL, value.Email, value.MAsset, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeMAsset:
		var assets []*ValueAsset
		for _, asset := range value.MAsset {
			if nil != asset && "" != strings.TrimSpace(asset.Content) {
				if AssetTypeFile != asset.Type && AssetTypeImage != asset.Type {
					return nil, fmt.Errorf("invalid asset type [%s]", asset.Type)
				}
				assets = append(assets, asset)
			}
		}
		value.MAsset = assets
		value.Text, value.Number, value.Date, value.MSelect, value.URL, value.Email, value.Phone, value.Checkbox, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return nil, errors.New("checkbox value is missing")
		}
		value.Text, value.Number, value.Date, value.MSelect, value.URL, value.Email, value.Phone, value.MAsset, value.Relation = nil, nil, nil, nil, nil, nil, nil, nil, nil
	case KeyTypeRelation:
		if nil == value.Relation {
			return nil, errors.New("relation value is missing")
		}
		for _, blockID := range value.Relation.BlockIDs {
			if !ast.IsNodeIDPattern(blockID) {
				return nil, fmt.Errorf("invalid relation block ID [%s]", blockID)
			}
		}
		value.Text, value.Number, value.Date, value.MSelect, value.URL, value.Email, value.Phone, value.MAsset, value.Checkbox = nil, nil, nil, nil, nil, nil, nil, nil, nil
	default:
		return nil, fmt.Errorf("unsupported value type [%s]", key.Type)
	}
	value.Block, value.Template, value.Created, value.Updated, value.Rollup = nil, nil, nil, nil, nil
	value.ID = ""
	value.KeyID = ""
	value.BlockID = ""
	value.Type = key.Type
	value.IsDetached = false
	value.CreatedAt = 0
	value.UpdatedAt = 0
	value.IsRenderAutoFill = false
	if nil != value.Number {
		value.Number.Format = key.NumberFormat
		value.Number.FormattedContent = ""
	}
	if nil != value.Date {
		value.Date.FormattedContent = ""
	}
	if nil != value.Created {
		value.Created.FormattedContent = ""
	}
	if nil != value.Updated {
		value.Updated.FormattedContent = ""
	}
	if nil != value.Relation {
		value.Relation.Contents = nil
	}
	return value, nil
}

func isNewItemTemplateEditableKeyType(keyType KeyType) bool {
	switch keyType {
	case KeyTypeText, KeyTypeNumber, KeyTypeDate, KeyTypeSelect, KeyTypeMSelect, KeyTypeURL, KeyTypeEmail,
		KeyTypePhone, KeyTypeMAsset, KeyTypeCheckbox, KeyTypeRelation:
		return true
	}
	return false
}

func cloneNewItemTemplate(itemTemplate *NewItemTemplate) *NewItemTemplate {
	if nil == itemTemplate {
		return nil
	}
	ret := &NewItemTemplate{
		ID:                  itemTemplate.ID,
		Name:                itemTemplate.Name,
		Icon:                itemTemplate.Icon,
		TargetType:          itemTemplate.TargetType,
		PrimaryKeyTemplate:  itemTemplate.PrimaryKeyTemplate,
		ContentTemplatePath: itemTemplate.ContentTemplatePath,
	}
	if nil != itemTemplate.SaveLocation {
		ret.SaveLocation = &NewItemSaveLocation{
			BoxID:        itemTemplate.SaveLocation.BoxID,
			PathTemplate: itemTemplate.SaveLocation.PathTemplate,
		}
	}
	if 0 < len(itemTemplate.FieldValues) {
		ret.FieldValues = map[string]*NewItemFieldValue{}
		for keyID, fieldValue := range itemTemplate.FieldValues {
			if nil == fieldValue {
				continue
			}
			cloned := &NewItemFieldValue{Mode: fieldValue.Mode}
			if nil != fieldValue.Value {
				cloned.Value = fieldValue.Value.Clone()
			}
			ret.FieldValues[keyID] = cloned
		}
	}
	return ret
}
