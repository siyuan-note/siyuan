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

package av

import (
	"bytes"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"text/template"

	"github.com/Masterminds/sprig/v3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// buildRollupTemplateContext 构造模板统计可用的数据上下文。
// values 为整列 rollup 单元格解析出的数字数组；strs 为各单元格的字符串形式；raw 为原始 Value 数组。
// 额外暴露预算聚合量 sum/avg/min/max/median/count/nonEmptyCount，便于简单公式直接引用。
func buildRollupTemplateContext(values []float64, strs []string, raw []*Value) map[string]any {
	ctx := map[string]any{
		"values":  values,
		"strings": strs,
		"raw":     raw,
		"count":   len(values),
	}

	var nonEmptyCount int
	var sum float64
	minVal := math.MaxFloat64
	maxVal := -math.MaxFloat64
	for _, v := range values {
		sum += v
		if v < minVal {
			minVal = v
		}
		if v > maxVal {
			maxVal = v
		}
		nonEmptyCount++
	}
	ctx["sum"] = sum
	ctx["nonEmptyCount"] = nonEmptyCount
	if 0 < nonEmptyCount {
		ctx["avg"] = sum / float64(nonEmptyCount)
		ctx["min"] = minVal
		ctx["max"] = maxVal

		sorted := make([]float64, nonEmptyCount)
		copy(sorted, values)
		sort.Float64s(sorted)
		if 0 == nonEmptyCount%2 {
			ctx["median"] = (sorted[nonEmptyCount/2-1] + sorted[nonEmptyCount/2]) / 2
		} else {
			ctx["median"] = sorted[nonEmptyCount/2]
		}
	} else {
		ctx["avg"] = float64(0)
		ctx["min"] = float64(0)
		ctx["max"] = float64(0)
		ctx["median"] = float64(0)
	}
	return ctx
}

// evalRollupTemplate 使用 text/template + sprig 渲染自定义模板统计内容。
// 返回渲染后的字符串；若该字符串可解析为数字则 isNumber 为 true 且 asNumber 为该数值。
// 解析或执行失败时返回 err，由调用方决定如何提示用户。
func evalRollupTemplate(templateContent string, ctx map[string]any) (rendered string, asNumber float64, isNumber bool, err error) {
	if "" == templateContent {
		return
	}

	goTpl := template.New("").Delims(".action{", "}").Funcs(templateFuncMap())
	tpl, parseErr := goTpl.Parse(templateContent)
	if nil != parseErr {
		err = fmt.Errorf("parse template [%s] failed: %s", templateContent, parseErr)
		return
	}

	buf := &bytes.Buffer{}
	if execErr := tpl.Execute(buf, ctx); nil != execErr {
		err = fmt.Errorf("execute template [%s] failed: %s", templateContent, execErr)
		return
	}

	rendered = buf.String()
	if "<no value>" == rendered {
		rendered = ""
		return
	}

	// 渲染结果若可解析为数字，则按数字处理（前端会按列数字格式显示）
	trimmed := strings.TrimSpace(rendered)
	if "" != trimmed {
		if num, parseErr := strconv.ParseFloat(trimmed, 64); nil == parseErr {
			asNumber = num
			isNumber = true
		}
	}
	return
}

// collectFieldValues 通用收集整列行值，用于任意字段类型的模板统计。
// 单值类型：每行收集一个值；多值类型（MSelect/MAsset）：每个子值单独收集，与原生 CountValues 语义一致。
// 空值判断用 IsBlank()（类型感知，正确处理 Checkbox/Created 等边界）。
func collectFieldValues(collection Collection, fieldIndex int) (nums []float64, strs []string, raw []*Value) {
	for _, item := range collection.GetItems() {
		values := item.GetValues()
		if nil == values[fieldIndex] || values[fieldIndex].IsBlank() {
			continue
		}
		v := values[fieldIndex]
		switch v.Type {
		case KeyTypeMSelect:
			for _, sel := range v.MSelect {
				val, _ := util.Convert2Float(sel.Content)
				nums = append(nums, val)
				strs = append(strs, sel.Content)
				raw = append(raw, &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{sel}})
			}
		case KeyTypeMAsset:
			for _, ast := range v.MAsset {
				content := ast.Name + " " + ast.Content
				val, _ := util.Convert2Float(content)
				nums = append(nums, val)
				strs = append(strs, content)
				raw = append(raw, &Value{Type: KeyTypeMAsset, MAsset: []*ValueAsset{ast}})
			}
		default:
			val, _ := util.Convert2Float(v.String(false))
			nums = append(nums, val)
			strs = append(strs, v.String(false))
			raw = append(raw, v)
		}
	}
	return
}

// calcFieldByTemplate 对任意字段类型执行模板统计（通用入口，非 Rollup）。
// 与 calcFieldRollup 中的 Template 分支不同，此处按整列行值收集，不遍历 Rollup.Contents。
func calcFieldByTemplate(collection Collection, field Field, fieldIndex int) {
	nums, strs, raw := collectFieldValues(collection, fieldIndex)
	if 0 == len(nums) {
		return
	}
	calc := field.GetCalc()
	ctx := buildRollupTemplateContext(nums, strs, raw)
	rendered, asNumber, isNumber, err := evalRollupTemplate(calc.Template, ctx)
	if nil != err {
		pushRollupTemplateErr(err)
		return
	}
	if isNumber {
		calc.Result = &Value{Number: NewFormattedValueNumber(asNumber, field.GetNumberFormat())}
	} else if "" != rendered {
		calc.Result = &Value{Type: KeyTypeText, Text: &ValueText{Content: rendered}}
	}
}

// pushRollupTemplateErr 将模板统计的解析/执行错误以 toast 形式推送给前端，
// 复用模板字段解析失败时的本地化提示文案（util.Langs[util.Lang][44]）。
func pushRollupTemplateErr(err error) {
	util.PushErrMsg(fmt.Sprintf(util.Langs[util.Lang][44], util.EscapeHTML(err.Error())), 30000)
}

// templateFuncMap 在 sprig 函数集基础上，补充表格计算专用的条件计数函数 countif。
func templateFuncMap() template.FuncMap {
	tplFuncs := sprig.TxtFuncMap()
	tplFuncs["countif"] = util.CountIf
	return tplFuncs
}
