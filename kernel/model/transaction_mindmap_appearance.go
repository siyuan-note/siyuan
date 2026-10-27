// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "regexp"

var listMindmapColorPattern = regexp.MustCompile(`(?i)^#[0-9a-f]{6}$`)

// 外观配置使用独立版本；只校验已知字段，扩展字段随文档原样保留。
func validListMindmapAppearance(value any) bool {
	data, ok := value.(map[string]any)
	if !ok || data["version"] != float64(1) {
		return false
	}
	palette, ok := data["palette"].([]any)
	if !ok || len(palette) > 24 {
		return false
	}
	for _, entry := range palette {
		color, ok := entry.(string)
		if !ok || !listMindmapColorPattern.MatchString(color) {
			return false
		}
	}
	if value, exists := data["rootColor"]; exists {
		color, ok := value.(string)
		if !ok || !listMindmapColorPattern.MatchString(color) {
			return false
		}
	}
	if value, exists := data["nodeStyle"]; exists && value != "layered" && value != "branch" {
		return false
	}
	if value, exists := data["backgroundColor"]; exists {
		color, ok := value.(string)
		if !ok || color != "" && !listMindmapColorPattern.MatchString(color) {
			return false
		}
	}
	return true
}
