// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package markdownappearance

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const customPrefix = "SiYuanCustomFont-"

var groups = []string{"theme", "fontSize", "fonts"}
var fontGroups = []string{"global", "editor", "code"}
var errInvalid = errors.New("invalid Markdown appearance configuration")

type Font struct {
	Family string `json:"family"`
	Weight int    `json:"weight"`
}

type CustomFont struct {
	Font
	URL string `json:"url"`
}

type Workspace struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	relative string
}

type Appearance struct {
	Theme       string            `json:"theme"`
	FontSize    int               `json:"fontSize"`
	Sources     map[string]string `json:"sources"`
	Workspaces  []Workspace       `json:"workspaces"`
	Fonts       map[string][]Font `json:"fonts"`
	CustomFonts []CustomFont      `json:"customFonts"`
	Independent map[string]any    `json:"independent"`
}

func object(value any) (map[string]any, bool) {
	ret, ok := value.(map[string]any)
	return ret, ok && ret != nil
}

func decodeObject(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	if len(raw) > 131072 || !utf8.ValidString(raw) {
		return nil, errInvalid
	}
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return nil, errInvalid
	}
	ret, ok := object(value)
	if !ok {
		return nil, errInvalid
	}
	return ret, nil
}

func validID(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func integer(value any, min, max int) (int, bool) {
	n, ok := value.(float64)
	return int(n), ok && math.Trunc(n) == n && n >= float64(min) && n <= float64(max)
}

func validFamily(family string, independent bool) bool {
	if family == "" || !utf8.ValidString(family) || independent && strings.HasPrefix(family, customPrefix) {
		return false
	}
	length := 0
	for _, c := range family {
		length += utf16.RuneLen(c)
		if c < 32 || c == 127 {
			return false
		}
	}
	return length <= 256
}

func parseFonts(value any, strict bool) ([]Font, error) {
	ret := []Font{}
	values, ok := value.([]any)
	if !ok {
		if strict {
			return nil, errInvalid
		}
		return ret, nil
	}
	if strict && len(values) > 32 {
		return nil, errInvalid
	}
	seen := map[string]bool{}
	for i, item := range values {
		if i >= 32 {
			break
		}
		font, ok := object(item)
		family, _ := font["family"].(string)
		if !ok || !validFamily(family, strict) {
			if strict {
				return nil, errInvalid
			}
			continue
		}
		weight, validWeight := integer(font["weight"], 1, 1000)
		if !validWeight {
			if strict {
				return nil, errInvalid
			}
			weight = 400
		}
		if strict {
			for key := range font {
				if key != "family" && key != "weight" {
					return nil, errInvalid
				}
			}
		}
		if !strict && seen[family] {
			continue
		}
		seen[family] = true
		ret = append(ret, Font{family, weight})
	}
	return ret, nil
}

func independent(value any) (map[string]any, error) {
	data, ok := object(value)
	if !ok {
		return nil, errInvalid
	}
	for key, value := range data {
		switch key {
		case "theme":
			if value != "system" && value != "light" && value != "dark" {
				return nil, errInvalid
			}
		case "fontSize":
			if _, ok := integer(value, 9, 72); !ok {
				return nil, errInvalid
			}
		case "fonts":
			fonts, ok := object(value)
			if !ok {
				return nil, errInvalid
			}
			for name := range fonts {
				if name != "global" && name != "editor" && name != "code" {
					return nil, errInvalid
				}
			}
			for _, name := range fontGroups {
				if _, err := parseFonts(fonts[name], true); err != nil {
					return nil, err
				}
			}
		default:
			return nil, errInvalid
		}
	}
	return data, nil
}

func normalizePreferences(raw string) (map[string]any, map[string]any, map[string]string, error) {
	prefs, err := decodeObject(raw)
	if err != nil {
		return nil, nil, nil, err
	}
	if prefs["mode"] == nil {
		prefs["mode"] = "ir"
	}
	if prefs["mode"] != "ir" && prefs["mode"] != "wysiwyg" && prefs["mode"] != "sv" {
		return nil, nil, nil, errInvalid
	}
	value, exists := prefs["independent"]
	if !exists {
		legacy := map[string]any{}
		for _, name := range groups {
			if v, ok := prefs[name]; ok {
				legacy[name] = v
			}
		}
		value = legacy
	}
	ind, err := independent(value)
	if err != nil {
		return nil, nil, nil, err
	}
	sources := map[string]string{"theme": "independent", "fontSize": "independent", "fonts": "independent"}
	if rawSources, exists := prefs["sources"]; exists {
		values, ok := object(rawSources)
		if !ok {
			return nil, nil, nil, errInvalid
		}
		for key, value := range values {
			id, ok := value.(string)
			if _, valid := sources[key]; !valid || !ok || id != "independent" && !validID(id) {
				return nil, nil, nil, errInvalid
			}
			sources[key] = id
		}
	}
	return prefs, ind, sources, nil
}

func initialAppearance(ind map[string]any) Appearance {
	ret := Appearance{Theme: "system", FontSize: 16, Fonts: map[string][]Font{}, CustomFonts: []CustomFont{}, Independent: ind}
	if value, ok := ind["theme"].(string); ok {
		ret.Theme = value
	}
	if value, ok := integer(ind["fontSize"], 9, 72); ok {
		ret.FontSize = value
	}
	fonts, _ := object(ind["fonts"])
	for _, group := range fontGroups {
		ret.Fonts[group], _ = parseFonts(fonts[group], false)
	}
	return ret
}
