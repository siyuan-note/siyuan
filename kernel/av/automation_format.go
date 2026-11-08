// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"text/template"
)

func boundedAutomationArguments(values []any) error {
	if len(values) > 64 {
		return fmt.Errorf("automation function exceeds 64 arguments")
	}
	data, err := json.Marshal(values)
	if err != nil || len(data) > AutomationTemplateLimit {
		return fmt.Errorf("automation function input exceeds 64 KiB")
	}
	return nil
}

func boundedAutomationString(value string) (string, error) {
	if len(value) > AutomationTemplateLimit {
		return "", fmt.Errorf("automation function output exceeds 64 KiB")
	}
	return value, nil
}

type automationFormatPart struct {
	text     string
	argument bool
}

func parseAutomationFormat(format string) ([]automationFormatPart, error) {
	if len(format) > 8192 {
		return nil, fmt.Errorf("automation format exceeds 8 KiB")
	}
	var parts []automationFormatPart
	for start := 0; start < len(format); {
		index := strings.IndexByte(format[start:], '%')
		if index < 0 {
			parts = append(parts, automationFormatPart{text: format[start:]})
			break
		}
		index += start
		parts = append(parts, automationFormatPart{text: format[start:index]})
		end := index + 1
		if end < len(format) && format[end] == '%' {
			parts = append(parts, automationFormatPart{text: "%"})
			start = end + 1
			continue
		}
		for end < len(format) && strings.ContainsRune("+-# 0", rune(format[end])) {
			end++
		}
		for part := 0; part < 2; part++ {
			number := end
			for end < len(format) && format[end] >= '0' && format[end] <= '9' {
				end++
			}
			if end > number {
				size, err := strconv.Atoi(format[number:end])
				if err != nil || size > AutomationTemplateLimit {
					return nil, fmt.Errorf("automation format width or precision exceeds 65536")
				}
			}
			if part == 0 && end < len(format) && format[end] == '.' {
				end++
			} else {
				break
			}
		}
		if end == len(format) || !strings.ContainsRune("vsqdboxXOcUtfFeEgGT", rune(format[end])) {
			return nil, fmt.Errorf("unsupported automation format directive")
		}
		parts = append(parts, automationFormatPart{text: format[index : end+1], argument: true})
		start = end + 1
	}
	return parts, nil
}

// 逐个格式符生成结果，避免格式化函数在输出上限检查前构造整段超大字符串。
func automationPrintf(format string, values ...any) (string, error) {
	parts, err := parseAutomationFormat(format)
	if err != nil {
		return "", err
	}
	if err = boundedAutomationArguments(values); err != nil {
		return "", err
	}
	output := &automationTemplateOutput{}
	argument := 0
	for _, part := range parts {
		text := part.text
		if part.argument {
			if argument >= len(values) {
				return "", fmt.Errorf("missing automation format argument")
			}
			if strings.ContainsAny(part.text, "0123456789.") && values[argument] != nil {
				kind := reflect.TypeOf(values[argument]).Kind()
				if kind == reflect.Map || kind == reflect.Slice || kind == reflect.Array || kind == reflect.Struct || kind == reflect.Pointer {
					return "", fmt.Errorf("automation format width and precision require a scalar argument")
				}
			}
			text = fmt.Sprintf(part.text, values[argument])
			argument++
		}
		if _, err = output.Write([]byte(text)); err != nil {
			return "", err
		}
	}
	if argument != len(values) {
		return "", fmt.Errorf("unused automation format argument")
	}
	return output.String(), nil
}

func automationURLQuery(values ...any) (string, error) {
	if err := boundedAutomationArguments(values); err != nil {
		return "", err
	}
	return boundedAutomationString(template.URLQueryEscaper(values...))
}

func automationToString(value any) (string, error) {
	if err := boundedAutomationArguments([]any{value}); err != nil {
		return "", err
	}
	return boundedAutomationString(fmt.Sprint(value))
}

func automationDict(values ...any) (map[string]any, error) {
	if len(values)%2 != 0 {
		return nil, fmt.Errorf("automation dict requires key/value pairs")
	}
	if err := boundedAutomationArguments(values); err != nil {
		return nil, err
	}
	ret := map[string]any{}
	for index := 0; index < len(values); index += 2 {
		key, ok := values[index].(string)
		if !ok {
			return nil, fmt.Errorf("automation dict keys must be strings")
		}
		ret[key] = values[index+1]
	}
	return ret, nil
}
