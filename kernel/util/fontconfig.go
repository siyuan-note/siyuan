// SiYuan - From thought to insight, with agents
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

package util

import (
	"bytes"
	"math"
	"strconv"
	"strings"
)

const (
	fontconfigPairSeparator   = "\x1c"
	fontconfigValueSeparator  = "\x1d"
	fontconfigRecordSeparator = "\x1e"
	fontconfigFieldSeparator  = "\x1f"
	fontconfigListFormat      = "%{[]family,familylang{" + fontconfigValueSeparator + "%{family}" +
		fontconfigPairSeparator + "%{familylang}}}" + fontconfigFieldSeparator +
		"%{[]style,stylelang{" + fontconfigValueSeparator + "%{style}" + fontconfigPairSeparator +
		"%{stylelang}}}" + fontconfigFieldSeparator +
		"%{[]fullname,fullnamelang{" + fontconfigValueSeparator + "%{fullname}" + fontconfigPairSeparator +
		"%{fullnamelang}}}" + fontconfigFieldSeparator +
		"%{[]postscriptname{" + fontconfigValueSeparator + "%{postscriptname}}}" + fontconfigFieldSeparator +
		"%{weight}" + fontconfigRecordSeparator
)

type fontconfigLocalizedName struct {
	Value string
	Lang  string
}

func parseFontconfigFonts(data []byte, lang string) (ret []*Font) {
	for _, record := range bytes.Split(data, []byte(fontconfigRecordSeparator)) {
		if 0 == len(record) {
			continue
		}
		fields := bytes.Split(record, []byte(fontconfigFieldSeparator))
		if 5 != len(fields) {
			continue
		}

		families := parseFontconfigLocalizedNames(string(fields[0]))
		styles := parseFontconfigLocalizedNames(string(fields[1]))
		fullNames := parseFontconfigLocalizedNames(string(fields[2]))
		postscriptNames := parseFontconfigValues(string(fields[3]))
		family := selectFontconfigName(families, "en")
		if "" == family {
			family = selectFontconfigName(families, lang)
		}
		if "" == family || strings.HasPrefix(family, ".") {
			continue
		}

		localizedFamily := selectFontconfigName(families, lang)
		if "" == localizedFamily {
			localizedFamily = family
		}
		style := selectFontconfigName(styles, "en")
		localizedStyle := selectFontconfigName(styles, lang)
		if "" == localizedStyle {
			localizedStyle = style
		}
		displayName := localizedFamily
		if "" != style && !strings.EqualFold(style, "Regular") {
			displayName += " " + localizedStyle
		}

		var aliases []string
		aliases = appendFontconfigLocalizedAliases(aliases, families)
		aliases = appendFontconfigLocalizedAliases(aliases, styles)
		aliases = appendFontconfigLocalizedAliases(aliases, fullNames)
		for _, name := range postscriptNames {
			aliases = appendFontAlias(aliases, name)
		}
		weight := parseFontconfigWeight(string(fields[4]), style)
		ret = addFont(ret, &Font{
			Family:      family,
			Weight:      weight,
			DisplayName: displayName,
			Aliases:     aliases,
		})
	}
	return
}

func parseFontconfigLocalizedNames(value string) (ret []fontconfigLocalizedName) {
	for _, item := range strings.Split(value, fontconfigValueSeparator) {
		item = strings.TrimSpace(item)
		if "" == item {
			continue
		}
		parts := strings.SplitN(item, fontconfigPairSeparator, 2)
		name := strings.TrimSpace(parts[0])
		if "" == name {
			continue
		}
		localizedName := fontconfigLocalizedName{Value: name}
		if 1 < len(parts) {
			localizedName.Lang = normalizeFontconfigLanguage(parts[1])
		}
		ret = append(ret, localizedName)
	}
	return
}

func parseFontconfigValues(value string) (ret []string) {
	for _, item := range strings.Split(value, fontconfigValueSeparator) {
		if item = strings.TrimSpace(item); "" != item {
			ret = append(ret, item)
		}
	}
	return
}

func selectFontconfigName(names []fontconfigLocalizedName, lang string) string {
	lang = normalizeFontconfigLanguage(LangToBCP47(lang))
	for _, name := range names {
		if lang == name.Lang && "" != name.Value {
			return name.Value
		}
	}
	for _, name := range names {
		if fontconfigLanguagesMatch(lang, name.Lang) && "" != name.Value {
			return name.Value
		}
	}
	for _, name := range names {
		if "" != name.Value {
			return name.Value
		}
	}
	return ""
}

func fontconfigLanguagesMatch(left, right string) bool {
	if "" == left || "" == right {
		return false
	}
	leftPrimary := strings.SplitN(left, "-", 2)[0]
	rightPrimary := strings.SplitN(right, "-", 2)[0]
	if leftPrimary != rightPrimary {
		return false
	}
	if "zh" != leftPrimary {
		return true
	}
	leftGroup := fontconfigChineseLanguageGroup(left)
	rightGroup := fontconfigChineseLanguageGroup(right)
	return "" == leftGroup || "" == rightGroup || leftGroup == rightGroup
}

func fontconfigChineseLanguageGroup(lang string) string {
	switch normalizeFontconfigLanguage(lang) {
	case "zh-cn", "zh-sg", "zh-hans":
		return "simplified"
	case "zh-tw", "zh-hk", "zh-mo", "zh-hant":
		return "traditional"
	default:
		return ""
	}
}

func normalizeFontconfigLanguage(lang string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(lang), "_", "-"))
}

func appendFontconfigLocalizedAliases(aliases []string, names []fontconfigLocalizedName) []string {
	for _, name := range names {
		aliases = appendFontAlias(aliases, name.Value)
	}
	return aliases
}

func parseFontconfigWeight(value, style string) int {
	weight, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if nil != err || weight < 0 || 215 < weight {
		return inferFontWeight(400, style)
	}
	points := [...]struct {
		fontconfig float64
		css        float64
	}{
		{fontconfig: 0, css: 100},
		{fontconfig: 40, css: 200},
		{fontconfig: 50, css: 300},
		{fontconfig: 55, css: 350},
		{fontconfig: 75, css: 380},
		{fontconfig: 80, css: 400},
		{fontconfig: 100, css: 500},
		{fontconfig: 180, css: 600},
		{fontconfig: 200, css: 700},
		{fontconfig: 205, css: 800},
		{fontconfig: 210, css: 900},
		{fontconfig: 215, css: 1000},
	}
	for i := 1; i < len(points); i++ {
		if weight <= points[i].fontconfig {
			previous := points[i-1]
			current := points[i]
			ratio := (weight - previous.fontconfig) / (current.fontconfig - previous.fontconfig)
			return int(math.Round(previous.css + ratio*(current.css-previous.css)))
		}
	}
	return 1000
}
