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

package model

import (
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

type headingNumberStyle string

const (
	headingNumberStyleDecimal    headingNumberStyle = "decimal"
	headingNumberStyleUpperAlpha headingNumberStyle = "upper-alpha"
	headingNumberStyleLowerAlpha headingNumberStyle = "lower-alpha"
	headingNumberStyleUpperRoman headingNumberStyle = "upper-roman"
	headingNumberStyleLowerRoman headingNumberStyle = "lower-roman"
	headingNumberStyleUpperGreek headingNumberStyle = "upper-greek"
	headingNumberStyleLowerGreek headingNumberStyle = "lower-greek"
	headingNumberStyleChinese    headingNumberStyle = "chinese"
	headingNumberStyleCircled    headingNumberStyle = "circled"
)

type headingNumberPreset struct {
	Styles    []headingNumberStyle
	Templates []string
}

type headingNumberEntry struct {
	Path  []int
	Label string
}

var hierarchicalHeadingNumberTemplates = []string{
	"{1}",
	"{1}.{2}",
	"{1}.{2}.{3}",
	"{1}.{2}.{3}.{4}",
	"{1}.{2}.{3}.{4}.{5}",
	"{1}.{2}.{3}.{4}.{5}.{6}",
}

func shouldReturnHeadingNumbers(mode int, isBacklink bool) bool {
	return !isBacklink && (0 == mode || 3 == mode)
}

// GetHeadingNumbers 返回文档标题块 ID 到显示编号的映射。
func GetHeadingNumbers(rootID, boxID string) (ret map[string]string, err error) {
	FlushTxQueue()
	tree, err := loadTreeByBlockIDInBox(rootID, boxID)
	if err != nil || nil == tree {
		return map[string]string{}, err
	}
	return headingNumberLabels(tree, Conf.Editor.HeadingNumberFormat), nil
}

func headingNumberLabels(tree *parse.Tree, format string) map[string]string {
	entries := buildHeadingNumberEntries(tree, format)
	ret := make(map[string]string, len(entries))
	for id, entry := range entries {
		ret[id] = entry.Label
	}
	return ret
}

func buildHeadingNumberEntries(tree *parse.Tree, format string) map[string]headingNumberEntry {
	ret := map[string]headingNumberEntry{}
	headings := collectOutlineHeadings(tree)
	if 0 == len(headings) {
		return ret
	}

	preset := headingNumberPresetByID(format)
	levels := make([]int, 0, 6)
	counters := make([]int, 0, 6)
	for _, heading := range headings {
		for 0 < len(levels) && levels[len(levels)-1] >= heading.HeadingLevel {
			levels = levels[:len(levels)-1]
		}
		depth := len(levels)
		levels = append(levels, heading.HeadingLevel)

		if depth == len(counters) {
			counters = append(counters, 0)
		} else {
			counters = counters[:depth+1]
		}
		counters[depth]++

		path := append([]int(nil), counters...)
		ret[heading.ID] = headingNumberEntry{
			Path:  path,
			Label: formatHeadingNumber(path, preset),
		}
	}
	return ret
}

func collectOutlineHeadings(tree *parse.Tree) (ret []*ast.Node) {
	if nil == tree || nil == tree.Root {
		return
	}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeHeading == n.Type &&
			!n.ParentIs(ast.NodeBlockquote) &&
			!n.ParentIs(ast.NodeCallout) &&
			!n.ParentIs(ast.NodeBlockQueryEmbed) {
			ret = append(ret, n)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return
}

func headingNumberPresetByID(id string) headingNumberPreset {
	hierarchicalPreset := func(style headingNumberStyle) headingNumberPreset {
		styles := make([]headingNumberStyle, 6)
		for i := range styles {
			styles[i] = style
		}
		return headingNumberPreset{Styles: styles, Templates: hierarchicalHeadingNumberTemplates}
	}

	switch id {
	case "upper-alpha-hierarchical":
		return hierarchicalPreset(headingNumberStyleUpperAlpha)
	case "lower-alpha-hierarchical":
		return hierarchicalPreset(headingNumberStyleLowerAlpha)
	case "upper-roman-hierarchical":
		return hierarchicalPreset(headingNumberStyleUpperRoman)
	case "lower-roman-hierarchical":
		return hierarchicalPreset(headingNumberStyleLowerRoman)
	case "upper-greek-hierarchical":
		return hierarchicalPreset(headingNumberStyleUpperGreek)
	case "lower-greek-hierarchical":
		return hierarchicalPreset(headingNumberStyleLowerGreek)
	case "decimal-parenthesized":
		return headingNumberPreset{
			Styles: []headingNumberStyle{
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
			},
			Templates: []string{"{1}）", "{2}）", "{3}）", "{4}）", "{5}）", "{6}）"},
		}
	case "chinese-document":
		return headingNumberPreset{
			Styles: []headingNumberStyle{
				headingNumberStyleChinese,
				headingNumberStyleChinese,
				headingNumberStyleDecimal,
				headingNumberStyleDecimal,
				headingNumberStyleCircled,
				headingNumberStyleUpperAlpha,
			},
			Templates: []string{"{1}、", "（{2}）", "{3}.", "（{4}）", "{5}", "{6}."},
		}
	default:
		return hierarchicalPreset(headingNumberStyleDecimal)
	}
}

func formatHeadingNumber(path []int, preset headingNumberPreset) string {
	if 0 == len(path) {
		return ""
	}
	depth := len(path) - 1
	if len(preset.Templates) <= depth {
		return strings.TrimSpace(strings.Join(intsToStrings(path), "."))
	}
	ret := preset.Templates[depth]
	for i, number := range path {
		style := headingNumberStyleDecimal
		if i < len(preset.Styles) {
			style = preset.Styles[i]
		}
		ret = strings.ReplaceAll(ret, "{"+strconv.Itoa(i+1)+"}", formatHeadingCounter(number, style))
	}
	return strings.TrimSpace(ret)
}

func intsToStrings(numbers []int) []string {
	ret := make([]string, len(numbers))
	for i, number := range numbers {
		ret[i] = strconv.Itoa(number)
	}
	return ret
}

func formatHeadingCounter(number int, style headingNumberStyle) string {
	switch style {
	case headingNumberStyleUpperAlpha:
		return alphabeticNumber(number, []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
	case headingNumberStyleLowerAlpha:
		return alphabeticNumber(number, []rune("abcdefghijklmnopqrstuvwxyz"))
	case headingNumberStyleUpperRoman:
		return romanNumber(number)
	case headingNumberStyleLowerRoman:
		return strings.ToLower(romanNumber(number))
	case headingNumberStyleUpperGreek:
		return alphabeticNumber(number, []rune("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ"))
	case headingNumberStyleLowerGreek:
		return alphabeticNumber(number, []rune("αβγδεζηθικλμνξοπρστυφχψω"))
	case headingNumberStyleChinese:
		return chineseNumber(number)
	case headingNumberStyleCircled:
		return circledNumber(number)
	default:
		return strconv.Itoa(number)
	}
}

func alphabeticNumber(number int, alphabet []rune) string {
	if 1 > number || 0 == len(alphabet) {
		return strconv.Itoa(number)
	}
	ret := make([]rune, 0, 4)
	base := len(alphabet)
	for 0 < number {
		number--
		ret = append([]rune{alphabet[number%base]}, ret...)
		number /= base
	}
	return string(ret)
}

func romanNumber(number int) string {
	if 1 > number || 3999 < number {
		return strconv.Itoa(number)
	}
	values := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	symbols := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var ret strings.Builder
	for i, value := range values {
		for value <= number {
			ret.WriteString(symbols[i])
			number -= value
		}
	}
	return ret.String()
}

func chineseNumber(number int) string {
	if 1 > number {
		return strconv.Itoa(number)
	}
	original := number
	bigUnits := []string{"", "万", "亿", "万亿"}
	ret := ""
	zeroPending := false
	lowerSection := 0
	unitIndex := 0
	for 0 < number {
		section := number % 10000
		if 0 == section {
			if "" != ret {
				zeroPending = true
			}
		} else {
			if len(bigUnits) <= unitIndex {
				return strconv.Itoa(original)
			}
			sectionText := chineseSection(section) + bigUnits[unitIndex]
			if "" != ret && (zeroPending || 1000 > lowerSection) {
				sectionText += "零"
			}
			ret = sectionText + ret
			zeroPending = false
		}
		lowerSection = section
		number /= 10000
		unitIndex++
	}
	if strings.HasPrefix(ret, "一十") {
		ret = "十" + strings.TrimPrefix(ret, "一十")
	}
	return ret
}

func chineseSection(section int) string {
	digits := []string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}
	units := []string{"", "十", "百", "千"}
	divisors := []int{1000, 100, 10, 1}
	var ret strings.Builder
	zeroPending := false
	for i, divisor := range divisors {
		digit := section / divisor
		section %= divisor
		if 0 == digit {
			if 0 < ret.Len() && 0 < section {
				zeroPending = true
			}
			continue
		}
		if zeroPending {
			ret.WriteString(digits[0])
			zeroPending = false
		}
		ret.WriteString(digits[digit])
		ret.WriteString(units[len(units)-1-i])
	}
	return ret.String()
}

func circledNumber(number int) string {
	numbers := []string{
		"", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
		"⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
	}
	if 0 < number && number < len(numbers) {
		return numbers[number]
	}
	return strconv.Itoa(number)
}
