// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"math"
	"math/big"
	"strconv"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// decimalSum 按数值的最短十进制表示精确累计，仅在生成结果时转换回 float64。
type decimalSum struct {
	total     big.Rat
	nonFinite float64 // 保留 NaN 和无穷值的浮点运算语义。
}

// 数字值直接参与聚合，文本值沿用已有转换规则。
func calculationNumber(value *Value) float64 {
	if nil != value && KeyTypeNumber == value.Type && nil != value.Number {
		return value.Number.Content
	}
	result, _ := util.Convert2Float(value.String(false))
	return result
}

func (sum *decimalSum) add(value float64) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		sum.nonFinite += value
		return
	}
	var term big.Rat
	term.SetString(strconv.FormatFloat(value, 'g', -1, 64))
	sum.total.Add(&sum.total, &term)
}

func (sum *decimalSum) float64() float64 {
	if 0 != sum.nonFinite {
		return sum.nonFinite
	}
	result, _ := sum.total.Float64()
	return result
}

func (sum *decimalSum) average(count int) float64 {
	if 0 != sum.nonFinite {
		return sum.nonFinite
	}
	var divisor, average big.Rat
	divisor.SetInt64(int64(count))
	average.Quo(&sum.total, &divisor)
	result, _ := average.Float64()
	return result
}

func numberMean(left, right float64) float64 {
	var sum decimalSum
	sum.add(left)
	sum.add(right)
	return sum.average(2)
}

func numberDifference(left, right float64) float64 {
	var sum decimalSum
	sum.add(left)
	sum.add(-right)
	return sum.float64()
}
