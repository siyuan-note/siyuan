package apicontract

// AVCalendarSettings 是 setAttrViewCalendar 事务的完整设置数据，也是日历布局的持久化字段设置。
// 月周模式和当前浏览日期由各编辑器独立维护，不写入共享设置。
// 切换布局保留其他布局及分组设置；日历渲染不应用分组。
type AVCalendarSettings struct {
	// 绑定一个 date、created 或 updated 字段；后两者不支持通过日历拖动修改。
	// 空字符串表示未绑定；字段缺失或类型变化时保留绑定，日历返回空行，不自动改绑或回填日期。
	DateKeyID string `json:"dateKeyID"`
	// 可选单选字段，使用已有选项颜色；空字符串表示不使用字段颜色。
	ColorKeyID string `json:"colorKeyID"`
	// 一周起始日，0 为星期日，1 为星期一，依次至 6 为星期六。
	WeekStart int `json:"weekStart"`
	// 月视图折叠前显示的条目行数，可选 3、5、10；-1 表示全部，省略或 0 按 3 行显示。
	// 仅控制客户端折叠，不限制查询结果；周视图始终显示全部条目。
	RowLimit int `json:"rowLimit,omitempty" api:"optional"`
}

// AVCalendarRange 是本次渲染的毫秒时间戳半开区间 [start, end)，不持久化。
// 必须满足 start < end，跨度不超过 63 * 24 小时，timeZone 必须是有效的 IANA 时区。
// 日期按该时区解释：全天结束日期包含当天，带时间的结束端点不包含在区间内。
// 日期缺少一个端点时按单点处理；反向区间按开始端点显示，原值保持不变；无日期条目不显示。
// 日历在筛选和排序后按区间交集取行，不应用行分页；定位目标可额外包含区间外的匹配条目。
// 渲染请求省略此参数或传 null 时不限制日期范围，保留完整渲染及导出的调用兼容性。
type AVCalendarRange struct {
	Start    int64  `json:"start"`
	End      int64  `json:"end"`
	TimeZone string `json:"timeZone"`
}

type AVLayoutCalendar struct {
	*AVBaseLayout
	Columns  []*AVViewTableColumn `json:"columns" api:"optional,nullable"`
	RowIDs   []string             `json:"rowIds" api:"optional,nullable"`
	Settings AVCalendarSettings   `json:"settings"`
}
