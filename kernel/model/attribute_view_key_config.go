// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

var AttributeViewKeyNumberFormats = []string{"", "commas", "percent", "USD", "CNY", "EUR", "GBP", "JPY", "RUB", "INR", "KRW", "TRY", "CAD", "CHF", "THB", "AUD", "HKD", "TWD", "MOP", "SGD", "NZD", "ILS", "SKK"}

var AttributeViewKeyRollupOperators = []string{"", "Unique values", "Count all", "Count values", "Count unique values", "Count empty", "Count not empty", "Percent empty", "Percent not empty", "Percent unique values", "Sum", "Average", "Median", "Min", "Max", "Range", "Earliest", "Latest", "Checked", "Unchecked", "Percent checked", "Percent unchecked"}

// UpdateAttributeViewKeyConfig 每次修改一个字段配置，先校验参数，再复用界面操作维护关联数据。
func UpdateAttributeViewKeyConfig(avID, keyID string, config map[string]any) (err error) {
	if 1 != len(config) {
		return errors.New("config must contain exactly one setting; use separate calls for multiple settings")
	}
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return err
	}
	key, err := attrView.GetKey(keyID)
	if nil != err {
		return err
	}
	op := &Operation{AvID: avID, ID: keyID, Typ: string(key.Type), Name: key.Name}
	for setting, value := range config {
		switch setting {
		case "name", "type", "icon", "desc", "numberFormat", "dateFormat", "template", "renderTemplate":
			text, ok := value.(string)
			if !ok {
				return fmt.Errorf("%s must be a string", setting)
			}
			op.Data, op.Format = text, text
			switch setting {
			case "name":
				if "" == strings.TrimSpace(text) {
					return errors.New("field name must not be empty")
				}
				op.Name = text
				return updateAttributeViewColumn(op)
			case "type":
				if _, err = newAttributeViewKey(keyID, key.Name, text, key.Icon, key.DateFormat); nil != err {
					return err
				}
				op.Typ = text
				return updateAttributeViewColumn(op)
			case "icon":
				return setAttributeViewColIcon(op)
			case "desc":
				return setAttributeViewColDesc(op)
			case "numberFormat":
				if av.KeyTypeNumber != key.Type || !slices.Contains(AttributeViewKeyNumberFormats, text) {
					return errors.New("numberFormat requires a number field and a supported format")
				}
				return updateAttributeViewColNumberFormat(op)
			case "dateFormat":
				return setAttributeViewColDateFormat(op)
			case "template":
				if av.KeyTypeTemplate != key.Type {
					return errors.New("template requires a template field; use renderTemplate for other fields")
				}
				return updateAttributeViewColTemplate(op)
			case "renderTemplate":
				if av.KeyTypeTemplate == key.Type {
					return errors.New("use template for a template field")
				}
				return updateAttributeViewColTemplate(op)
			}
		case "autoFillNow", "fillSpecificTime", "includeTime":
			flag, ok := value.(bool)
			if !ok {
				return fmt.Errorf("%s must be a boolean", setting)
			}
			op.Data = flag
			if "includeTime" == setting {
				switch key.Type {
				case av.KeyTypeCreated:
					return setAttrViewCreatedIncludeTime(op)
				case av.KeyTypeUpdated:
					return setAttrViewUpdatedIncludeTime(op)
				}
				return errors.New("includeTime requires a created or updated field")
			}
			if av.KeyTypeDate != key.Type {
				return fmt.Errorf("%s requires a date field", setting)
			}
			if "autoFillNow" == setting {
				return setAttributeViewColDateFillCreated(op)
			}
			return setAttrViewColDateFillSpecificTime(op)
		case "options", "optionUpdate", "optionRemove":
			if av.KeyTypeSelect != key.Type && av.KeyTypeMSelect != key.Type {
				return errors.New("option settings require a select or mSelect field")
			}
			return updateAttributeViewKeyOptions(attrView, key, op, setting, value)
		case "relation":
			return updateAttributeViewKeyRelation(key, op, value)
		case "rollup":
			return updateAttributeViewKeyRollup(attrView, key, op, value)
		case "relationFilters", "rollupFilters":
			filters, ok := value.([]any)
			if !ok {
				return errors.New("filters must be an array")
			}
			if err = validateAttributeViewKeyFilters(attrView, key, setting, filters); nil != err {
				return err
			}
			return setAttrViewColFilters(avID, "", keyID, filters, "relationFilters" == setting)
		default:
			return fmt.Errorf("unknown field setting: %s", setting)
		}
	}
	return
}

func validateAttributeViewKeyFilters(attrView *av.AttributeView, key *av.Key, setting string, value []any) error {
	relationKey := key
	if "rollupFilters" == setting {
		if av.KeyTypeRollup != key.Type || nil == key.Rollup {
			return errors.New("rollupFilters requires a configured rollup field")
		}
		var err error
		relationKey, err = attrView.GetKey(key.Rollup.RelationKeyID)
		if nil != err {
			return err
		}
	}
	if av.KeyTypeRelation != relationKey.Type || nil == relationKey.Relation {
		return errors.New("filters require a configured relation field")
	}
	dest, err := av.ParseAttributeView(relationKey.Relation.AvID)
	if nil != err {
		return err
	}
	var filters []*av.ViewFilter
	if err = decodeAttributeViewKeyConfig(value, &filters); nil != err {
		return err
	}
	if err = av.ValidateFilterDepth(filters); nil != err {
		return err
	}
	var validate func([]*av.ViewFilter) error
	validate = func(items []*av.ViewFilter) error {
		for _, filter := range items {
			if nil == filter {
				return errors.New("filter must not be null")
			}
			if filter.IsGroup() {
				if av.FilterCombinationAnd != filter.Combination && av.FilterCombinationOr != filter.Combination {
					return errors.New("filter group requires and/or combination")
				}
				if err := validate(filter.Filters); nil != err {
					return err
				}
			} else if _, err := dest.GetKey(filter.Column); nil != err {
				return fmt.Errorf("invalid filter target field: %s", filter.Column)
			}
		}
		return nil
	}
	return validate(filters)
}

// decodeAttributeViewKeyConfig 拒绝未知字段及空值，防止拼写错误被当作成功更新。
func decodeAttributeViewKeyConfig(value, dest any) error {
	if nil == value {
		return errors.New("configuration must not be null")
	}
	data, err := json.Marshal(value)
	if nil != err {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func updateAttributeViewKeyOptions(attrView *av.AttributeView, key *av.Key, op *Operation, setting string, value any) error {
	if "options" == setting {
		var options []*av.SelectOption
		if err := decodeAttributeViewKeyConfig(value, &options); nil != err {
			return err
		}
		if 0 == len(options) {
			return errors.New("options must not be empty; use optionRemove to delete existing options")
		}
		names := map[string]bool{}
		for _, option := range options {
			if nil == option || "" == strings.TrimSpace(option.Name) {
				return errors.New("each option requires a nonempty name")
			}
			if names[option.Name] {
				return errors.New("duplicate option name")
			}
			if attrView.FilterColorValue(option.Color) != option.Color {
				return errors.New("invalid option color")
			}
			names[option.Name] = true
		}
		op.Data = options
		return updateAttributeViewColumnOptions(op)
	}
	if "optionRemove" == setting {
		name, ok := value.(string)
		if !ok || nil == key.GetOption(name) {
			return errors.New("optionRemove must name an existing option")
		}
		op.Data = name
		return removeAttributeViewColumnOption(op)
	}
	var config struct {
		Name    string  `json:"name"`
		NewName *string `json:"newName"`
		Color   *string `json:"color"`
		Desc    *string `json:"desc"`
	}
	if err := decodeAttributeViewKeyConfig(value, &config); nil != err {
		return err
	}
	option := key.GetOption(config.Name)
	if nil == option {
		return errors.New("optionUpdate must name an existing option")
	}
	name, color, desc := option.Name, option.Color, option.Desc
	if nil != config.NewName {
		name = strings.TrimSpace(*config.NewName)
		if "" == name {
			return errors.New("new option name must not be empty")
		}
		if name != option.Name && nil != key.GetOption(name) {
			return errors.New("new option name already exists")
		}
	}
	if nil != config.Color {
		color = *config.Color
		if attrView.FilterColorValue(color) != color {
			return errors.New("invalid option color")
		}
	}
	if nil != config.Desc {
		desc = *config.Desc
	}
	if name == option.Name {
		op.Data = []*av.SelectOption{{Name: name, Color: color, Desc: desc}}
		return updateAttributeViewColumnOptions(op)
	}
	op.Data = map[string]any{"oldName": option.Name, "newName": name, "newColor": color, "newDesc": desc}
	return updateAttributeViewColumnOption(op)
}

func updateAttributeViewKeyRelation(key *av.Key, op *Operation, value any) error {
	if av.KeyTypeRelation != key.Type {
		return errors.New("relation requires a relation field")
	}
	var config struct {
		AvID        string `json:"avID"`
		IsTwoWay    *bool  `json:"isTwoWay"`
		BackKeyName string `json:"backKeyName"`
	}
	if err := decodeAttributeViewKeyConfig(value, &config); nil != err {
		return err
	}
	if nil == config.IsTwoWay || "" == config.AvID {
		return errors.New("relation requires avID and isTwoWay")
	}
	dest, err := av.ParseAttributeView(config.AvID)
	if nil != err {
		return err
	}
	// 先认证已有目标，避免无法读取旧关联时静默跳过回链清理。
	if nil != key.Relation && "" != key.Relation.AvID {
		if _, err := av.ParseAttributeView(key.Relation.AvID); nil != err {
			return err
		}
	}
	op.ID, op.KeyID, op.Format = config.AvID, key.ID, key.Name
	op.IsTwoWay, op.Name = *config.IsTwoWay, config.BackKeyName
	if op.IsTwoWay {
		op.BackRelationKeyID = ast.NewNodeID()
		if nil != key.Relation && key.Relation.IsTwoWay && key.Relation.AvID == config.AvID {
			op.BackRelationKeyID = key.Relation.BackKeyID
			backKey, getErr := dest.GetKey(op.BackRelationKeyID)
			if nil != getErr || av.KeyTypeRelation != backKey.Type || nil == backKey.Relation ||
				backKey.Relation.AvID != op.AvID || backKey.Relation.BackKeyID != key.ID {
				return errors.New("existing back relation is invalid")
			}
			if "" == config.BackKeyName {
				op.Name = backKey.Name
			}
		}
	}
	err = updateAttributeViewColRelation(op)
	if nil == err {
		ReloadAttrView(config.AvID)
		if nil != key.Relation && key.Relation.AvID != config.AvID {
			ReloadAttrView(key.Relation.AvID)
		}
	}
	return err
}

func updateAttributeViewKeyRollup(attrView *av.AttributeView, key *av.Key, op *Operation, value any) error {
	if av.KeyTypeRollup != key.Type {
		return errors.New("rollup requires a rollup field")
	}
	var config struct {
		RelationKeyID string  `json:"relationKeyID"`
		KeyID         string  `json:"keyID"`
		Operator      *string `json:"operator"`
	}
	if err := decodeAttributeViewKeyConfig(value, &config); nil != err {
		return err
	}
	if nil == config.Operator || !slices.Contains(AttributeViewKeyRollupOperators, *config.Operator) {
		return errors.New("rollup requires a supported operator")
	}
	relationKey, err := attrView.GetKey(config.RelationKeyID)
	if nil != err || av.KeyTypeRelation != relationKey.Type || nil == relationKey.Relation {
		return errors.New("rollup requires a configured relation field")
	}
	dest, err := av.ParseAttributeView(relationKey.Relation.AvID)
	if nil != err {
		return err
	}
	if _, err = dest.GetKey(config.KeyID); nil != err {
		return err
	}
	calc := &av.RollupCalc{Operator: av.CalcOperator(*config.Operator)}
	op.ParentID, op.KeyID = config.RelationKeyID, config.KeyID
	op.Data = map[string]any{"calc": calc}
	return updateAttributeViewColRollup(op)
}
