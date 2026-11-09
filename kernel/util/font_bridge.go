// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"sort"
	"strings"
)

// 原生平台仅负责发现可用字体，名称、字重、去重和排序共用内核规则。
func NormalizeSysFontsJSON(raw string) string {
	if len(raw) > 4*1024*1024 {
		return "[]"
	}
	var input []*Font
	if json.Unmarshal([]byte(raw), &input) != nil {
		return "[]"
	}
	fonts := []*Font{}
	for _, font := range input {
		if font == nil {
			continue
		}
		font.Family = strings.TrimSpace(font.Family)
		if font.Family == "" || strings.ContainsAny(font.Family, "\x00\r\n") {
			continue
		}
		font.DisplayName = strings.TrimSpace(font.DisplayName)
		if font.DisplayName == "" {
			font.DisplayName = font.Family
		}
		if font.Weight < 1 || font.Weight > 1000 {
			font.Weight = 400
		}
		switch font.Spacing {
		case FontSpacingProportional, FontSpacingDual, FontSpacingMonospace, FontSpacingCharacterCell:
		default:
			font.Spacing = ""
		}
		fonts = addFont(fonts, font)
	}
	sort.Slice(fonts, func(i, j int) bool { return fonts[i].DisplayName < fonts[j].DisplayName })
	data, err := json.Marshal(fonts)
	if err != nil {
		return "[]"
	}
	return string(data)
}
