package apicontract

// AVMapSettings 是 setAttrViewMap 事务的完整设置和地图渲染响应中的设置。
// 地图只显示本次返回行页的标记，沿用普通视图的筛选、排序和分页。
// 分组设置保留但不参与地图渲染；普通导出和发布展示记录，不加载地图服务。
// 交互地图固定使用内置 OpenFreeMap，位置值使用 WGS84。
type AVMapSettings struct {
	// 位置字段 ID；空字符串表示未选择。字段缺失或类型变化时保留绑定，记录仍然返回。
	// 隐藏的字段仍包含在 columns 和 rows.cells 中，客户端仅为有效 WGS84 坐标绘制标记。
	LocationKeyID string `json:"locationKeyID"`
}

type AVLayoutMap struct {
	*AVBaseLayout
	Columns  []*AVViewTableColumn `json:"columns" api:"optional,nullable"`
	RowIDs   []string             `json:"rowIds" api:"optional,nullable"`
	Settings AVMapSettings        `json:"settings"`
}
