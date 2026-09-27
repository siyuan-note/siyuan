package apicontract

// AVConditionalColorRule 是 setAttrViewConditionalColors 事务数组中的单字段规则。
// 规则仅影响所属视图，按数组顺序匹配。item 为条目背景，property 仅在表格中给条件所属属性着色。
// 各属性取首个匹配色；整条目规则命中后结束匹配，保留此前属性色。默认色同样占据优先级。
// matchOption 使用条目中第一个已选选项的颜色；无选项时跳过，不使用字段选项定义顺序。
// 最多 100 条规则；空数组清空设置且不恢复旧日历颜色，null 不接受。事务保留撤销、重做和加密存储语义。
type AVConditionalColorRule struct {
	ID          string         `json:"id"`
	Filter      *AVViewFilter  `json:"filter"`
	Target      string         `json:"target" api:"enum=item|property"`
	Color       *AVValueSelect `json:"color" api:"nullable"`
	MatchOption bool           `json:"matchOption"`
}

// AVItemConditionalColors 是当前返回条目的派生颜色，不持久化。
type AVItemConditionalColors struct {
	Background *AVValueSelect            `json:"background,omitempty" api:"optional"`
	Properties map[string]*AVValueSelect `json:"properties,omitempty" api:"optional"`
}
