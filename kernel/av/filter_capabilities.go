package av

import "slices"

type FilterProfile string

const (
	FilterProfileNone     FilterProfile = "none"
	FilterProfileText     FilterProfile = "text"
	FilterProfileTemplate FilterProfile = "template"
	FilterProfileNumber   FilterProfile = "number"
	FilterProfileDate     FilterProfile = "date"
	FilterProfileCheckbox FilterProfile = "checkbox"
	FilterProfileSelect   FilterProfile = "select"
	FilterProfileMSelect  FilterProfile = "mSelect"
	FilterProfileRelation FilterProfile = "relation"
	FilterProfileRollup   FilterProfile = "rollup"
)

// 筛选接受集合用于工具校验，呈现集合保留界面选项顺序与汇总关联的特殊选择。
// 两者不能合并，复选框的 Is true/Is false 只属于接受集合。
type FilterCapability struct {
	Accepted      []FilterOperator `json:"accepted"`
	Offered       []FilterOperator `json:"offered"`
	OfferedRollup []FilterOperator `json:"offeredRollup,omitempty"`
}

var filterCapabilities = map[FilterProfile]FilterCapability{
	FilterProfileNone: {Accepted: []FilterOperator{}, Offered: []FilterOperator{}},
	FilterProfileText: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileTemplate: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty,
			FilterOperatorIsGreater, FilterOperatorIsLess, FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual},
		Offered: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty,
			FilterOperatorIsGreater, FilterOperatorIsLess, FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual},
	},
	FilterProfileNumber: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater,
			FilterOperatorIsLess, FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater,
			FilterOperatorIsLess, FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileDate: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsGreater, FilterOperatorIsLess,
			FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual, FilterOperatorIsBetween, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsGreater, FilterOperatorIsLess,
			FilterOperatorIsGreaterOrEqual, FilterOperatorIsLessOrEqual, FilterOperatorIsBetween, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileCheckbox: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsTrue, FilterOperatorIsFalse},
		Offered:  []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual},
	},
	FilterProfileSelect: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered:  []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileMSelect: {
		Accepted: []FilterOperator{FilterOperatorContains, FilterOperatorDoesNotContain, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered:  []FilterOperator{FilterOperatorContains, FilterOperatorDoesNotContain, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileRelation: {
		Accepted: []FilterOperator{FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		Offered: []FilterOperator{FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
		OfferedRollup: []FilterOperator{FilterOperatorContains, FilterOperatorDoesNotContain, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty},
	},
	FilterProfileRollup: {
		Accepted: []FilterOperator{FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater,
			FilterOperatorIsGreaterOrEqual, FilterOperatorIsLess, FilterOperatorIsLessOrEqual, FilterOperatorContains,
			FilterOperatorDoesNotContain, FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem,
			FilterOperatorIsEmpty, FilterOperatorIsNotEmpty, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsBetween},
		Offered: []FilterOperator{},
	},
}

func IsFilterOperatorAllowed(typ KeyType, operator FilterOperator) bool {
	// 历史工具校验允许未知字段类型使用空值筛选，其余算子仍不放行。
	if !IsKnownKeyType(typ) {
		return operator == FilterOperatorIsEmpty || operator == FilterOperatorIsNotEmpty
	}
	return slices.Contains(filterCapabilities[GetKeyCapability(typ).FilterProfile].Accepted, operator)
}

// calcFilterNumber 明确登记全部汇总算子的筛选类型；false 表示继续使用目标字段或现有内容类型。
// Range 保留目标类型回退，不能与总是按数值展示的算子合并。
var calcFilterNumber = map[CalcOperator]bool{
	CalcOperatorNone: false, CalcOperatorUniqueValues: false,
	CalcOperatorCountAll: true, CalcOperatorCountValues: true, CalcOperatorCountUniqueValues: true,
	CalcOperatorCountEmpty: true, CalcOperatorCountNotEmpty: true, CalcOperatorPercentEmpty: true,
	CalcOperatorPercentNotEmpty: true, CalcOperatorPercentUniqueValues: true,
	CalcOperatorSum: true, CalcOperatorAverage: true, CalcOperatorMedian: true, CalcOperatorMin: true, CalcOperatorMax: true,
	CalcOperatorRange: false, CalcOperatorEarliest: false, CalcOperatorLatest: false,
	CalcOperatorChecked: true, CalcOperatorUnchecked: true, CalcOperatorPercentChecked: true, CalcOperatorPercentUnchecked: true,
	CalcOperatorTemplate: false,
}
