// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/xml"
	"path/filepath"
	"strings"
)

type androidFontConfig struct {
	XMLName     xml.Name            `xml:"familyset"`
	Families    []androidFontFamily `xml:"family"`
	FamilyLists []struct {
		Name     string              `xml:"name,attr"`
		Families []androidFontFamily `xml:"family"`
	} `xml:"family-list"`
	Aliases []struct {
		Name string `xml:"name,attr"`
		To   string `xml:"to,attr"`
	} `xml:"alias"`
}

type androidFontFamily struct {
	Name  string `xml:"name,attr"`
	Fonts []struct {
		File   string `xml:",chardata"`
		Weight int    `xml:"weight,attr"`
		Style  string `xml:"style,attr"`
	} `xml:"font"`
}

func parseAndroidFontConfig(data []byte, resolve func(string) []*Font) []*Font {
	var config androidFontConfig
	if err := xml.Unmarshal(data, &config); err != nil {
		return nil
	}
	var ret []*Font
	for _, list := range config.FamilyLists {
		for _, family := range list.Families {
			family.Name = list.Name
			config.Families = append(config.Families, family)
		}
	}
	for _, family := range config.Families {
		name := strings.TrimSpace(family.Name)
		// 无名字体族仅参与字符回退，不能作为 WebView 的字体族选项。
		if name == "" {
			continue
		}
		for _, entry := range family.Fonts {
			file := strings.TrimSpace(entry.File)
			if file == "" || filepath.Base(file) != file || file == "." || file == ".." {
				continue
			}
			metadata := resolve(file)
			if len(metadata) == 0 {
				continue
			}
			weight := entry.Weight
			if weight == 0 {
				weight = 400
			}
			if weight < 1 || weight > 1000 {
				continue
			}
			font := &Font{Family: name, Weight: weight, DisplayName: name,
				nonNormalStyle: isNonNormalFontStyle(entry.Style)}
			for _, parsed := range metadata {
				font.Aliases = mergeFontAliases(font.Aliases, parsed.Aliases)
				font.Aliases = appendFontAlias(font.Aliases, parsed.Family)
				font.Aliases = appendFontAlias(font.Aliases, parsed.DisplayName)
				font.Spacing = mergeFontSpacing(font.Spacing, parsed.Spacing)
			}
			for _, alias := range config.Aliases {
				if alias.To == name {
					font.Aliases = appendFontAlias(font.Aliases, alias.Name)
				}
			}
			ret = addFont(ret, font)
		}
	}
	return ret
}
