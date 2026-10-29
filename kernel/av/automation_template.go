// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"text/template"
	"text/template/parse"
	"time"
	_ "time/tzdata"

	"github.com/Masterminds/sprig/v3"
)

const AutomationTemplateLimit = 65536

// AutomationTemplateContext 只暴露本次触发的存储快照，不提供工作区查询或写入函数。
type AutomationTemplateContext struct {
	Source   *AttributeView
	ItemID   string
	Time     time.Time
	TimeZone string
}

type automationTemplateOutput struct{ bytes.Buffer }

func (output *automationTemplateOutput) Write(data []byte) (int, error) {
	if output.Len()+len(data) > AutomationTemplateLimit {
		return 0, fmt.Errorf("automation template output exceeds 64 KiB")
	}
	return output.Buffer.Write(data)
}

// 自动化不执行循环、递归模板或可放大输入的函数，执行成本由源码、输入和输出上限共同约束。
func automationTemplate(context AutomationTemplateContext, source string) (*template.Template, error) {
	if len(source) > 8192 {
		return nil, fmt.Errorf("automation template exceeds 8 KiB")
	}
	zone, err := time.LoadLocation(context.TimeZone)
	if err != nil || context.TimeZone == "" || context.TimeZone == "Local" {
		return nil, fmt.Errorf("invalid automation time zone [%s]", context.TimeZone)
	}
	functions := template.FuncMap{}
	all := sprig.TxtFuncMap()
	for _, name := range []string{"add", "add1", "sub", "mul", "div", "mod", "max", "min", "addf", "subf", "mulf", "divf", "maxf", "minf", "floor", "ceil", "round", "trim", "trimPrefix", "trimSuffix", "upper", "lower", "contains", "hasPrefix", "hasSuffix", "default", "empty", "coalesce", "ternary"} {
		functions[name] = all[name]
	}
	functions["now"] = func() time.Time { return context.Time.In(zone) }
	functions["parseTime"] = func(text string) (time.Time, error) { return ParseAutomationTime(text, zone) }
	functions["date"] = func(layout string, date time.Time) string { return date.In(zone).Format(layout) }
	functions["field"] = func(id string) (any, error) { return context.field(id, zone, false) }
	functions["value"] = func(id string) (any, error) { return context.field(id, zone, true) }
	functions["toJson"] = func(value any) (string, error) {
		data, err := json.Marshal(value)
		if len(data) > AutomationTemplateLimit {
			return "", fmt.Errorf("automation template value exceeds 64 KiB")
		}
		return string(data), err
	}
	functions["dateAdd"] = func(years, months, days int, date *ValueDate) (*ValueDate, error) {
		if date == nil || !date.IsNotEmpty {
			return nil, fmt.Errorf("automation source date is empty")
		}
		result := *date
		result.Content = time.UnixMilli(date.Content).In(zone).AddDate(years, months, days).UnixMilli()
		if date.HasEndDate && date.IsNotEmpty2 {
			result.Content2 = time.UnixMilli(date.Content2).In(zone).AddDate(years, months, days).UnixMilli()
		}
		result.FormattedContent = ""
		return &result, nil
	}
	tpl, err := template.New("automation").Delims(".action{", "}").Option("missingkey=error").Funcs(functions).Parse(source)
	if err != nil {
		return nil, err
	}
	if len(tpl.Templates()) != 1 {
		return nil, fmt.Errorf("automation template definitions are unavailable")
	}
	count := 0
	var inspect func(parse.Node) error
	inspect = func(node parse.Node) error {
		if node == nil {
			return nil
		}
		count++
		if count > 512 {
			return fmt.Errorf("automation template is too complex")
		}
		var children []parse.Node
		switch node := node.(type) {
		case *parse.ListNode:
			if node == nil {
				return nil
			}
			children = node.Nodes
		case *parse.ActionNode:
			children = []parse.Node{node.Pipe}
		case *parse.PipeNode:
			for _, command := range node.Cmds {
				children = append(children, command)
			}
		case *parse.CommandNode:
			children = node.Args
			if len(node.Args) > 0 {
				if name, ok := node.Args[0].(*parse.IdentifierNode); ok {
					if functions[name.Ident] == nil && !strings.Contains("|and|or|not|eq|ne|lt|le|gt|ge|len|index|slice|", "|"+name.Ident+"|") {
						return fmt.Errorf("automation function [%s] is unavailable", name.Ident)
					}
					if name.Ident == "field" || name.Ident == "value" {
						if len(node.Args) != 2 {
							return fmt.Errorf("field requires a literal field ID")
						}
						if _, ok = node.Args[1].(*parse.StringNode); !ok {
							return fmt.Errorf("field requires a literal field ID")
						}
					}
				}
			}
		case *parse.IfNode:
			children = []parse.Node{node.Pipe, node.List, node.ElseList}
		case *parse.WithNode:
			children = []parse.Node{node.Pipe, node.List, node.ElseList}
		case *parse.ChainNode:
			if slices.Contains(node.Field, "Local") {
				return fmt.Errorf("automation templates use the saved time zone")
			}
			children = []parse.Node{node.Node}
		case *parse.FieldNode:
			if slices.Contains(node.Ident, "Local") {
				return fmt.Errorf("automation templates use the saved time zone")
			}
		case *parse.VariableNode:
			if slices.Contains(node.Ident, "Local") {
				return fmt.Errorf("automation templates use the saved time zone")
			}
		case *parse.RangeNode, *parse.TemplateNode:
			return fmt.Errorf("automation template loops and recursion are unavailable")
		}
		for _, child := range children {
			if err := inspect(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err = inspect(tpl.Tree.Root); err != nil {
		return nil, err
	}
	return tpl, nil
}

func ValidateAutomationTemplate(source, timeZone string) error {
	_, err := automationTemplate(AutomationTemplateContext{TimeZone: timeZone}, source)
	return err
}

func (context AutomationTemplateContext) field(id string, zone *time.Location, raw bool) (any, error) {
	if context.Source == nil {
		return nil, fmt.Errorf("automation source is unavailable")
	}
	key, err := context.Source.GetKey(id)
	if err != nil || !AutomationEditableKey(key.Type) {
		return nil, fmt.Errorf("automation template source field [%s] is unavailable", id)
	}
	value := NormalizeAutomationValue(context.Source.GetValue(id, context.ItemID))
	if value == nil {
		value = NormalizeAutomationValue(&Value{Type: key.Type})
	}
	data, err := json.Marshal(value)
	if err != nil || len(data) > AutomationTemplateLimit {
		return nil, fmt.Errorf("automation source field exceeds 64 KiB")
	}
	switch key.Type {
	case KeyTypeBlock:
		return value.Block.Content, nil
	case KeyTypeText:
		return value.Text.Content, nil
	case KeyTypeURL:
		return value.URL.Content, nil
	case KeyTypeEmail:
		return value.Email.Content, nil
	case KeyTypePhone:
		return value.Phone.Content, nil
	case KeyTypeNumber:
		if raw {
			return value.Number, nil
		}
		if !value.Number.IsNotEmpty {
			return nil, fmt.Errorf("automation source number is empty")
		}
		return value.Number.Content, nil
	case KeyTypeDate:
		if !value.Date.IsNotEmpty {
			return nil, fmt.Errorf("automation source date is empty")
		}
		if raw {
			return value.Date, nil
		}
		return time.UnixMilli(value.Date.Content).In(zone), nil
	case KeyTypeCheckbox:
		return value.Checkbox.Checked, nil
	case KeyTypeSelect, KeyTypeMSelect:
		return value.MSelect, nil
	case KeyTypeRelation:
		return value.Relation.BlockIDs, nil
	case KeyTypeMAsset:
		return value.MAsset, nil
	case KeyTypeLocation:
		return value.Location, nil
	}
	return nil, fmt.Errorf("unsupported automation source field")
}

func EvaluateAutomationTemplate(context AutomationTemplateContext, key *Key, source string) (*Value, error) {
	tpl, err := automationTemplate(context, source)
	if err != nil {
		return nil, err
	}
	output := &automationTemplateOutput{}
	if err = tpl.Execute(output, map[string]any{"ItemID": context.ItemID}); err != nil {
		return nil, err
	}
	zone, _ := time.LoadLocation(context.TimeZone)
	return ParseAutomationTemplateValue(key, output.String(), zone)
}

func ParseAutomationTime(text string, zone *time.Location) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05 -0700 MST", "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if value, err := time.ParseInLocation(layout, text, zone); err == nil {
			return value, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid automation date [%s]", text)
}

func decodeAutomationJSON(source string, value any) error {
	decoder := json.NewDecoder(strings.NewReader(source))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("invalid trailing automation JSON")
	}
	return nil
}

// ParseAutomationTemplateValue 仅转换目标类型的载荷，引用存在性由事务在同一认证边界内检查。
func ParseAutomationTemplateValue(key *Key, source string, zone *time.Location) (*Value, error) {
	if len(source) > AutomationTemplateLimit {
		return nil, fmt.Errorf("automation template value exceeds 64 KiB")
	}
	if !AutomationEditableKey(key.Type) {
		return nil, fmt.Errorf("automation field is read-only")
	}
	value := NormalizeAutomationValue(&Value{Type: key.Type})
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return value, nil
	}
	var err error
	switch key.Type {
	case KeyTypeBlock:
		value.Block.Content = source
	case KeyTypeText:
		value.Text.Content = source
	case KeyTypeURL:
		value.URL.Content = source
	case KeyTypeEmail:
		value.Email.Content = source
	case KeyTypePhone:
		value.Phone.Content = source
	case KeyTypeNumber:
		value.Number.Content, err = strconv.ParseFloat(trimmed, 64)
		value.Number.IsNotEmpty = err == nil
		if math.IsNaN(value.Number.Content) || math.IsInf(value.Number.Content, 0) {
			err = fmt.Errorf("automation number must be finite")
		}
	case KeyTypeCheckbox:
		if trimmed != "true" && trimmed != "false" {
			err = fmt.Errorf("automation checkbox requires true or false")
		} else {
			value.Checkbox.Checked = trimmed == "true"
		}
	case KeyTypeDate:
		if strings.HasPrefix(trimmed, "{") {
			err = decodeAutomationJSON(trimmed, value.Date)
			if err == nil && (!value.Date.IsNotEmpty || value.Date.HasEndDate && (!value.Date.IsNotEmpty2 || value.Date.Content2 < value.Date.Content)) {
				err = fmt.Errorf("invalid automation date range")
			}
		} else {
			var date time.Time
			date, err = ParseAutomationTime(trimmed, zone)
			if err == nil {
				value.Date = &ValueDate{Content: date.UnixMilli(), IsNotEmpty: true, IsNotTime: len(trimmed) == 10}
			}
		}
		value.Date.FormattedContent = ""
		if err == nil {
			start := time.UnixMilli(value.Date.Content).In(zone)
			end := time.UnixMilli(value.Date.Content2).In(zone)
			if start.Year() < 1 || start.Year() > 9999 || value.Date.HasEndDate && (end.Year() < 1 || end.Year() > 9999) {
				err = fmt.Errorf("automation date is outside the supported range")
			}
		}
	case KeyTypeSelect, KeyTypeMSelect:
		var names []string
		if key.Type == KeyTypeSelect && !strings.HasPrefix(trimmed, "[") {
			names = []string{source}
		} else {
			err = decodeAutomationJSON(trimmed, &value.MSelect)
			if err != nil {
				err = decodeAutomationJSON(trimmed, &names)
			} else {
				for _, option := range value.MSelect {
					if option == nil {
						err = fmt.Errorf("invalid automation option")
						break
					}
					names = append(names, option.Content)
				}
			}
		}
		value.MSelect = nil
		if key.Type == KeyTypeSelect && len(names) > 1 {
			err = fmt.Errorf("automation select requires one option")
		}
		seen := map[string]bool{}
		for _, name := range names {
			option := key.GetOption(name)
			if option == nil {
				err = fmt.Errorf("automation option [%s] does not exist", name)
				break
			}
			if !seen[name] {
				value.MSelect = append(value.MSelect, &ValueSelect{Content: name, Color: option.Color})
				seen[name] = true
			}
		}
	case KeyTypeRelation:
		err = decodeAutomationJSON(trimmed, &value.Relation.BlockIDs)
		if len(value.Relation.BlockIDs) > 1000 {
			err = fmt.Errorf("automation relation exceeds 1000 items")
		}
	case KeyTypeMAsset:
		err = decodeAutomationJSON(trimmed, &value.MAsset)
		if len(value.MAsset) > 1000 {
			err = fmt.Errorf("automation assets exceed 1000 items")
		}
	case KeyTypeLocation:
		err = decodeAutomationJSON(trimmed, value.Location)
		if err == nil {
			err = value.Location.Normalize()
		}
	}
	if err != nil {
		return nil, fmt.Errorf("automation template field [%s]: %w", key.Name, err)
	}
	return value, nil
}

// 只改写语法树中 field/value 的字面量参数，保留模板之外的同名文字。
func RemapAutomationTemplate(source string, ids map[string]string) string {
	tpl, err := automationTemplate(AutomationTemplateContext{TimeZone: "UTC"}, source)
	if err != nil {
		return source
	}
	type replacement struct {
		offset, length int
		text           string
	}
	var replacements []replacement
	var visit func(parse.Node)
	visit = func(node parse.Node) {
		if node == nil {
			return
		}
		switch node := node.(type) {
		case *parse.ListNode:
			if node != nil {
				for _, child := range node.Nodes {
					visit(child)
				}
			}
		case *parse.ActionNode:
			visit(node.Pipe)
		case *parse.PipeNode:
			for _, command := range node.Cmds {
				visit(command)
			}
		case *parse.CommandNode:
			if len(node.Args) == 2 {
				name, ok := node.Args[0].(*parse.IdentifierNode)
				argument, literal := node.Args[1].(*parse.StringNode)
				if ok && literal && (name.Ident == "field" || name.Ident == "value") {
					if id := ids[argument.Text]; id != "" {
						position := int(argument.Position())
						if position >= 0 && position+len(argument.Quoted) <= len(source) && source[position:position+len(argument.Quoted)] == argument.Quoted {
							replacements = append(replacements, replacement{position, len(argument.Quoted), strconv.Quote(id)})
						}
					}
				}
			}
			for _, child := range node.Args {
				visit(child)
			}
		case *parse.IfNode:
			visit(node.Pipe)
			visit(node.List)
			visit(node.ElseList)
		case *parse.WithNode:
			visit(node.Pipe)
			visit(node.List)
			visit(node.ElseList)
		case *parse.ChainNode:
			visit(node.Node)
		}
	}
	visit(tpl.Tree.Root)
	sort.Slice(replacements, func(i, j int) bool { return replacements[i].offset > replacements[j].offset })
	for _, replacement := range replacements {
		source = source[:replacement.offset] + replacement.text + source[replacement.offset+replacement.length:]
	}
	return source
}
