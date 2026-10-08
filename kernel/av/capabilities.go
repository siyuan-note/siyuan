package av

import "sort"

// KeyCapability 描述字段的基础能力，不参与属性视图的持久化。
// 资源字段仅在设置显示模板后支持分组，关联汇总的默认算子按取值来源调整。
type KeyCapability struct {
	ValueKind       string         `json:"valueKind"`
	Editable        bool           `json:"editable"`
	Filterable      bool           `json:"filterable"`
	Sortable        bool           `json:"sortable"`
	Groupable       bool           `json:"groupable"`
	DefaultOperator FilterOperator `json:"defaultOperator"`
	order           int
}

var keyCapabilities = map[KeyType]KeyCapability{
	KeyTypeBlock: {order: 0, ValueKind: "text", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeText: {order: 1, ValueKind: "text", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeNumber: {order: 2, ValueKind: "number", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeDate: {order: 3, ValueKind: "date", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeSelect: {order: 4, ValueKind: "options", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeMSelect: {order: 5, ValueKind: "options", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeURL: {order: 6, ValueKind: "text", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeEmail: {order: 7, ValueKind: "text", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypePhone: {order: 8, ValueKind: "text", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeMAsset: {order: 9, ValueKind: "assets", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeTemplate: {order: 10, ValueKind: "text", Editable: false, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContains},
	KeyTypeCreated: {order: 11, ValueKind: "timestamp", Editable: false, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeUpdated: {order: 12, ValueKind: "timestamp", Editable: false, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeCheckbox: {order: 13, ValueKind: "checkbox", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorIsEqual},
	KeyTypeRelation: {order: 14, ValueKind: "relation", Editable: true, Filterable: true,
		Sortable: true, Groupable: true, DefaultOperator: FilterOperatorContainsAnyItem},
	KeyTypeRollup: {order: 15, ValueKind: "rollup", Editable: false, Filterable: true,
		Sortable: true, Groupable: false, DefaultOperator: FilterOperatorContains},
	KeyTypeLineNumber: {order: 16, ValueKind: "lineNumber", Editable: false, Filterable: false,
		Sortable: false, Groupable: false, DefaultOperator: ""},
}

// GetKeyCapability 返回能力声明的副本，未知类型不具备任何基础能力。
func GetKeyCapability(typ KeyType) KeyCapability {
	return keyCapabilities[typ]
}

// KeyTypes 按字段声明顺序返回类型，供生成器和能力枚举使用。
func KeyTypes() []KeyType {
	ret := make([]KeyType, 0, len(keyCapabilities))
	for typ := range keyCapabilities {
		ret = append(ret, typ)
	}
	sort.Slice(ret, func(i, j int) bool { return keyCapabilities[ret[i]].order < keyCapabilities[ret[j]].order })
	return ret
}

// 筛选算子清单用于生成联合类型，完整性测试会核对所有 FilterOperator 常量。
var filterOperators = []FilterOperator{
	FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater, FilterOperatorIsGreaterOrEqual,
	FilterOperatorIsLess, FilterOperatorIsLessOrEqual, FilterOperatorContains, FilterOperatorDoesNotContain,
	FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem, FilterOperatorIsEmpty, FilterOperatorIsNotEmpty,
	FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsBetween, FilterOperatorIsTrue, FilterOperatorIsFalse,
}

func FilterOperators() []FilterOperator {
	return append([]FilterOperator(nil), filterOperators...)
}

func IsDateKeyType(typ KeyType) bool {
	kind := GetKeyCapability(typ).ValueKind
	return kind == "date" || kind == "timestamp"
}

func IsSelectKeyType(typ KeyType) bool {
	return GetKeyCapability(typ).ValueKind == "options"
}
