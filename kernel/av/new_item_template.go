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
	if 0 == len(templates) {
		defaultTemplate := newDefaultNewItemTemplate()
		templates = append(templates, defaultTemplate)
		defaultTemplateID = defaultTemplate.ID
		templateIDs[defaultTemplate.ID] = true
	}

	if "" != defaultTemplateID && !templateIDs[defaultTemplateID] {
		return fmt.Errorf("default new item template [%s] not found", defaultTemplateID)
	}
	av.NewItemTemplates = templates
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
