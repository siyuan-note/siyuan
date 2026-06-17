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
	"math"
	"sort"
	"strconv"
	"strings"
	"text/template"

	"github.com/Masterminds/sprig/v3"
	"github.com/siyuan-note/logging"
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
// 解析或执行失败时记日志并返回空结果（isNumber 为 false）。
func evalRollupTemplate(templateContent string, ctx map[string]any) (rendered string, asNumber float64, isNumber bool) {
	if "" == templateContent {
		return
	}

	goTpl := template.New("").Delims(".action{", "}").Funcs(sprig.TxtFuncMap())
	tpl, err := goTpl.Parse(templateContent)
	if nil != err {
		logging.LogWarnf("parse rollup template [%s] failed: %s", templateContent, err)
		return
	}

	buf := &bytes.Buffer{}
	if err = tpl.Execute(buf, ctx); nil != err {
		logging.LogWarnf("execute rollup template [%s] failed: %s", templateContent, err)
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
