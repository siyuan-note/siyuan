package apicontract

// DynamicIconRequest 生成动态图标 SVG。文字图标（type=8）跟随全局默认字体列表和首选字重，日期类图标使用内置字体和常规字重。
// 未配置全局字体时使用内置字体列表；字体由客户端解析，不嵌入字体文件，缺失字体时继续回退。
type DynamicIconRequest struct {
	Type        string `json:"type" api:"optional"`
	Color       string `json:"color" api:"optional"`
	Date        string `json:"date" api:"optional"`
	Lang        string `json:"lang" api:"optional"`
	WeekdayType string `json:"weekdayType" api:"optional"`
	Content     string `json:"content" api:"optional"`
	ID          string `json:"id" api:"optional"`
}
