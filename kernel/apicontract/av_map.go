package apicontract

// AVMapHeight 是按视图保存的地图高度档位，单位为 CSS px。
type AVMapHeight int

// AVMapSettings 是 setAttrViewMap 事务的完整设置和地图渲染响应中的设置。
// 地图只显示本次返回行页的标记，沿用普通视图的筛选、排序和分页。
// 分组设置保留但不参与地图渲染；普通导出和发布展示记录，不加载地图服务。
// 交互地图固定使用内置 OpenFreeMap，位置值使用 WGS84。
type AVMapSettings struct {
	// 位置字段 ID；空字符串按视图顺序派生首个位置字段，不写回设置。显式字段缺失或类型变化时保留绑定，记录仍然返回。
	// 隐藏的字段仍包含在 columns 和 rows.cells 中，客户端仅为有效 WGS84 坐标绘制标记。
	LocationKeyID string `json:"locationKeyID"`
	// 可选高度为 320、480、640 或 800px；省略按 480px 展示，不写回旧设置。显式 0 和 null 无效。
	Height AVMapHeight `json:"height,omitempty" api:"optional"`
}

type AVLayoutMap struct {
	*AVBaseLayout
	Columns  []*AVViewTableColumn `json:"columns" api:"optional,nullable"`
	RowIDs   []string             `json:"rowIds" api:"optional,nullable"`
	Settings AVMapSettings        `json:"settings"`
}

// AVMapUnplacedRequest 读取当前地图视图选定位置字段尚无坐标的条目，不修改视图或数据库。
// query 沿用当前视图搜索，search 仅匹配未定位条目的标题；页码从 1 开始，页大小默认 50，最大 100。
// 端点仅供可编辑管理员使用，并按 blockID 保持加密笔记本读取租约。
type AVMapUnplacedRequest struct {
	ID       string   `json:"id"`
	BlockID  string   `json:"blockID" api:"optional,nullable"`
	ViewID   string   `json:"viewID"`
	Query    string   `json:"query" api:"optional,nullable"`
	Search   string   `json:"search" api:"optional,nullable"`
	Page     *float64 `json:"page" api:"optional,nullable"`
	PageSize *float64 `json:"pageSize" api:"optional,nullable"`
}

// AVMapUnplacedData 返回未定位条目的独立分页，包含主键和位置字段单元格。
// total 在当前视图筛选、上下文筛选、视图搜索及本列表标题搜索之后计算，不受地图行分页影响。
type AVMapUnplacedData struct {
	Rows  []*AVTableRow `json:"rows" api:"optional,nullable"`
	Total int           `json:"total"`
}
