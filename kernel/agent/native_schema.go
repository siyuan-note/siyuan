// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"encoding/json"
	"strings"
)

// 模型侧展开本地引用并简化存在性约束；执行仍使用注册时编译的完整 schema 校验。
func nativeModelSchema(value any) any {
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var root map[string]any
	if json.Unmarshal(data, &root) != nil {
		return value
	}
	var project func(map[string]any, int) map[string]any
	complete := true
	project = func(schema map[string]any, depth int) map[string]any {
		if depth > 32 {
			complete = false
			return schema
		}
		if ref, ok := schema["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") {
			defs, _ := root["$defs"].(map[string]any)
			name := strings.ReplaceAll(strings.ReplaceAll(strings.TrimPrefix(ref, "#/$defs/"), "~1", "/"), "~0", "~")
			if target, ok := defs[name].(map[string]any); ok {
				copyData, _ := json.Marshal(target)
				var expanded map[string]any
				_ = json.Unmarshal(copyData, &expanded)
				for key, value := range schema {
					if key != "$ref" {
						expanded[key] = value
					}
				}
				schema = expanded
			} else {
				complete = false
			}
		}
		for _, keyword := range []string{"anyOf", "oneOf", "allOf"} {
			if alternatives, ok := schema[keyword].([]any); ok {
				presenceOnly := len(alternatives) > 0
				for _, alternative := range alternatives {
					part, ok := alternative.(map[string]any)
					if !ok || len(part) != 1 || part["required"] == nil {
						presenceOnly = false
					}
				}
				if presenceOnly {
					delete(schema, keyword)
				} else {
					for i, alternative := range alternatives {
						if part, ok := alternative.(map[string]any); ok {
							alternatives[i] = project(part, depth+1)
						}
					}
				}
			}
		}
		if values, ok := schema["enum"].([]any); ok {
			for _, value := range values {
				if value == "" {
					encoded, _ := json.Marshal(values)
					description, _ := schema["description"].(string)
					schema["description"] = strings.TrimSpace(description + " Allowed values: " + string(encoded))
					delete(schema, "enum")
					break
				}
			}
		}
		if properties, ok := schema["properties"].(map[string]any); ok {
			for key, value := range properties {
				if property, ok := value.(map[string]any); ok {
					properties[key] = project(property, depth+1)
				}
			}
		}
		for _, keyword := range []string{"items", "additionalProperties"} {
			if child, ok := schema[keyword].(map[string]any); ok {
				schema[keyword] = project(child, depth+1)
			}
		}
		return schema
	}
	projected := project(root, 0)
	if !complete {
		return value
	}
	delete(projected, "$defs")
	return projected
}
