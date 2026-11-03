// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type RemoveUnusedAttributeViewRequest struct {
	ID string `json:"id"`
}

type GetAttributeViewItemIDsByBoundIDsRequest struct {
	AvID     string   `json:"avID"`
	BlockIDs []string `json:"blockIDs"`
}

type GetAttributeViewBoundBlockIDsByItemIDsRequest struct {
	AvID    string   `json:"avID"`
	ItemIDs []string `json:"itemIDs"`
}

type GetAttributeViewItemStatusesRequest struct {
	// Nested 启用树形归组状态判断，结果不受展开状态或分页影响。
	Nested  *AVNestedRequest `json:"nested" api:"optional,nullable"`
	ID      string           `json:"id"`
	BlockID string           `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID  string           `json:"viewID" api:"optional,nullable,ignoretype"`
	Query   string           `json:"query" api:"optional,nullable,ignoretype"`
	ItemIDs []string         `json:"itemIDs"`
}

type GetAttributeViewAddingBlockDefaultValuesRequest struct {
	AvID          string `json:"avID"`
	BlockID       string `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID        string `json:"viewID" api:"optional,nullable"`
	GroupID       string `json:"groupID" api:"optional,nullable"`
	PreviousID    string `json:"previousID" api:"optional,nullable"`
	AddingBlockID string `json:"addingBlockID" api:"optional,nullable"`
}

// 无图标的普通块继承原条目图标，已有文档或已设置图标的普通块使用自身图标。
type BatchReplaceAttributeViewBlocksRequest struct {
	AvID       string              `json:"avID"`
	IsDetached bool                `json:"isDetached"`
	OldNew     []map[string]string `json:"oldNew"`
}

type SetAttrViewGroupRequest struct {
	AvID       string      `json:"avID"`
	BlockID    string      `json:"blockID"`
	Group      AVViewGroup `json:"group"`
	IgnoreRows bool        `json:"ignoreRows" api:"optional,nullable"`
}

type SetAttrViewFiltersRequest struct {
	AvID    string          `json:"avID"`
	BlockID string          `json:"blockID"`
	Data    []*AVViewFilter `json:"data"`
}

type SetAttrViewContextFilterRequest struct {
	AvID    string `json:"avID"`
	BlockID string `json:"blockID"`
	// KeyID 允许直接关联或目标为关联且显示原值/唯一值的汇总字段；省略或为空时关闭筛选。
	// 汇总按最终目标条目 ID 匹配，不为新增条目回填计算值或修改中间关联。
	KeyID string `json:"keyID" api:"optional,nullable,ignoretype"`
}

type SetAttrViewSortsRequest struct {
	AvID    string        `json:"avID"`
	BlockID string        `json:"blockID"`
	Data    []*AVViewSort `json:"data"`
}

type ChangeAttrViewLayoutRequest struct {
	BlockID    string `json:"blockID"`
	AvID       string `json:"avID"`
	LayoutType string `json:"layoutType"`
}

type DuplicateAttributeViewBlockRequest struct {
	AvID string `json:"avID"`
}

type GetAttributeViewKeysByAvIDRequest struct {
	AvID string `json:"avID"`
}

type GetAttributeViewKeysByIDRequest struct {
	AvID        string   `json:"avID"`
	KeyIDs      []string `json:"keyIDs"`
	KeyIDsError error    `json:"-"`
}

type GetMirrorDatabaseBlocksRequest struct {
	AvID string `json:"avID"`
}

type SetDatabaseBlockViewRequest struct {
	ID     string `json:"id"`
	ViewID string `json:"viewID"`
	AvID   string `json:"avID"`
}

type GetAttributeViewPrimaryKeyValuesRequest struct {
	ID       string   `json:"id"`
	Page     *float64 `json:"page" api:"optional,nullable"`
	PageSize *float64 `json:"pageSize" api:"optional,nullable"`
	Keyword  string   `json:"keyword" api:"optional,nullable"`
	BlockIDs []string `json:"blockIDs" api:"optional,nullable,filterstrings"`
	// 关联详情筛选的依赖读取由来源关系及逐跳字段决定目标，不接受客户端指定存储域。
	BlockID                   string                       `json:"blockID" api:"optional,nullable"`
	RelationDependencyContext *AVRelationDependencyContext `json:"relationDependencyContext" api:"optional,nullable"`
}

type GetAttributeViewRelationCandidatesRequest struct {
	// RelationContext 关联详情的来源条目；限定候选及新增模板预览使用同一真实存储边界，省略时保持原有行为。
	RelationContext *AVRelationContext `json:"relationContext" api:"optional,nullable"`
	// 表内关联单元格使用根明细上下文及当前成员条目，avID/keyID 指向该表的关联字段。
	// 与 relationContext 互斥；blockID 是根来源的真实上下文，不充当表内字段或候选目标的载体。
	RelationCellContext *AVRelationCellContext `json:"relationCellContext" api:"optional,nullable"`
	// ExcludeItemIDs 在计数和分页前排除指定条目及其后代。
	ExcludeItemIDs []string `json:"excludeItemIDs" api:"optional,nullable,filterstrings"`
	// 按需返回目标数据库默认条目的名称预览；省略时保持候选查询响应。
	// BlockID 指定来源载体并限定候选读取的加密边界；省略时保留原有全局查询行为。
	IncludeNewItemPreview bool     `json:"includeNewItemPreview" api:"optional,nullable"`
	BlockID               string   `json:"blockID" api:"optional,nullable"`
	AvID                  string   `json:"avID" api:"optional,nullable,ignoretype"`
	KeyID                 string   `json:"keyID" api:"optional,nullable,ignoretype"`
	ID                    string   `json:"id" api:"optional,nullable,ignoretype"`
	Keyword               string   `json:"keyword" api:"optional,nullable"`
	Page                  *float64 `json:"page" api:"optional,nullable"`
	PageSize              *float64 `json:"pageSize" api:"optional,nullable"`
	SelectedBlockIDs      []string `json:"selectedBlockIDs" api:"optional,nullable,filterstrings"`
	// Sort 仅对本次候选查询排序，在搜索过滤后、分页前应用；不修改数据库视图或已选条目的顺序。
	// 省略时按创建时间倒序；指定时 column 必须属于关联数据库，order 为 ASC 或 DESC。
	Sort *AVRelationCandidateSort `json:"sort" api:"optional,nullable"`
}

type AVRelationCandidateSort struct {
	Column string `json:"column"`
	Order  string `json:"order"`
}

type AppendAttributeViewDetachedBlocksWithValuesRequest struct {
	AvID         string       `json:"avID"`
	BlocksValues [][]*AVValue `json:"blocksValues"`
}

// AddAttributeViewBlocksRequest 新增的条目会在同一事务中触发数据库自动化；失败时恢复本次写入。
type AddAttributeViewBlocksRequest struct {
	AvID              string          `json:"avID"`
	BlockID           string          `json:"blockID" api:"optional,nullable"`
	ViewID            string          `json:"viewID" api:"optional,nullable"`
	GroupID           string          `json:"groupID" api:"optional,nullable"`
	PreviousID        string          `json:"previousID" api:"optional,nullable"`
	Srcs              []AVBlockSource `json:"srcs"`
	IgnoreDefaultFill bool            `json:"ignoreDefaultFill" api:"optional,nullable"`
}

type RemoveAttributeViewBlocksRequest struct {
	AvID   string   `json:"avID"`
	SrcIDs []string `json:"srcIDs"`
}

type AddAttributeViewKeyRequest struct {
	AvID          string `json:"avID"`
	BlockID       string `json:"blockID" api:"optional,nullable,ignoretype"`
	KeyID         string `json:"keyID"`
	KeyName       string `json:"keyName"`
	KeyType       string `json:"keyType"`
	KeyIcon       string `json:"keyIcon"`
	PreviousKeyID string `json:"previousKeyID"`
}

type RemoveAttributeViewKeyRequest struct {
	AvID               string `json:"avID"`
	KeyID              string `json:"keyID"`
	RemoveRelationDest bool   `json:"removeRelationDest" api:"optional,nullable"`
}

type SortAttributeViewViewKeyRequest struct {
	AvID          string `json:"avID"`
	ViewID        string `json:"viewID" api:"optional,nullable"`
	KeyID         string `json:"keyID"`
	PreviousKeyID string `json:"previousKeyID"`
}

type SortAttributeViewKeyRequest struct {
	AvID          string `json:"avID"`
	KeyID         string `json:"keyID"`
	PreviousKeyID string `json:"previousKeyID"`
}

type GetAttributeViewFilterSortRequest struct {
	ID      string `json:"id"`
	BlockID string `json:"blockID"`
}

type SearchAttributeViewRollupDestKeysRequest struct {
	AvID    string `json:"avID"`
	Keyword string `json:"keyword"`
}

type SearchAttributeViewRelationKeyRequest struct {
	AvID    string `json:"avID"`
	Keyword string `json:"keyword"`
}

type GetAttributeViewRequest struct {
	ID string `json:"id"`
	// BlockID 为目标数据库真实载体；使用 RelationFieldContext 或 RelationDependencyContext 时为根来源数据库
	// 的真实载体或该来源库实际绑定的块。字段配置上下文必须提供此来源块。
	BlockID string `json:"blockID" api:"optional,nullable"`
	// RelationFieldContext 由来源字段决定目标及存储边界；仅返回视图选择元数据，不包含条目。
	RelationFieldContext *AVRelationFieldContext `json:"relationFieldContext" api:"optional,nullable"`
	// 与 RelationFieldContext 互斥；返回依赖库字段定义，不包含条目值。
	RelationDependencyContext *AVRelationDependencyContext `json:"relationDependencyContext" api:"optional,nullable"`
}

type AVRelationDependencyContext struct {
	RelationContext AVRelationContext `json:"relationContext"`
	// 从关联详情目标库出发的一至两个真实关联字段，逐跳使用已验证的相同存储边界。
	RelationKeyIDs []string `json:"relationKeyIDs"`
}

type AVRelationFieldContext struct {
	SourceAvID    string `json:"sourceAvID"`
	RelationKeyID string `json:"relationKeyID"`
}

type GetAttributeViewPasteRowsRequest struct {
	// ItemIDs 显式指定当前可见窗口中的目标顺序，空数组表示没有现有目标。
	// 指定时不按平铺顺序补充隐藏条目；所有 ID 必须属于当前数据库且不可重复。
	ItemIDs     []string `json:"itemIDs" api:"optional,nullable"`
	AvID        string   `json:"avID" api:"trim"`
	BlockID     string   `json:"blockID" api:"trim"`
	ViewID      string   `json:"viewID" api:"optional,nullable"`
	GroupID     string   `json:"groupID" api:"optional,nullable"`
	Query       string   `json:"query" api:"optional,nullable"`
	StartItemID string   `json:"startItemID" api:"trim"`
	Count       float64  `json:"count"`
}

type GetAttributeViewFieldViewsRequest struct {
	AvID  string `json:"avID" api:"trim"`
	KeyID string `json:"keyID" api:"trim"`
}

type CreateAttributeViewItemRequest struct {
	Selection *DocumentSelection `json:"selection,omitempty" api:"optional,nonnullable"`
	// 日历新条目的全天日期，单位为毫秒；仅支持绑定普通 date 字段的日历视图。
	// 覆盖模板中该字段的值，与模板其他字段及条目创建共用一个可撤销事务。
	// 绑定 created、updated 或带显示模板的 date 字段时拒绝指定日期；省略或传 null 时沿用常规创建流程。
	CalendarDate *int64 `json:"calendarDate" api:"optional,nullable"`
	AvID         string `json:"avID"`
	BlockID      string `json:"blockID"`
	ViewID       string `json:"viewID" api:"optional,nullable"`
	TemplateID   string `json:"templateID" api:"optional,nullable"`
	PreviousID   string `json:"previousID" api:"optional,nullable"`
	GroupID      string `json:"groupID" api:"optional,nullable"`
	App          string `json:"app" api:"optional,nullable"`
	Session      string `json:"session" api:"optional,nullable"`
}

// 关联新建使用目标数据库的默认模板；未配置主键模板时以 keyword 作为名称。
// cells 保留已有条目的顺序及批量编辑结果，新条目追加到每个来源单元格；创建和关联共用一次撤销。
// preview 来自 includeNewItemPreview 候选查询，解析时间最多保留五分钟；默认模板 ID 或名称变化时拒绝写入。
// 不可用保存笔记本返回 code 1 和 unavailableNotebook；其他失败返回 code -1，保留原数据。
type CreateAttributeViewRelationItemRequest struct {
	// 明细模式仅接受与上下文匹配的一个来源单元格，忽略旧 relatedItemIDs，事务内增量追加当前关系。
	RelationContext *AVRelationContext `json:"relationContext" api:"optional,nullable"`
	// 与 relationContext 互斥；cells 条目集合须与 sourceItemIDs 一致，忽略旧 relatedItemIDs。
	// 只创建一个目标条目，再按各来源单元格执行时的当前值增量连接；父项字段保持单选替换。
	// 根 blockID 只提供授权与撤销上下文，默认模板及文档位置使用实际新建目标库的上下文。
	RelationCellContext *AVRelationCellContext `json:"relationCellContext" api:"optional,nullable"`
	Selection           *DocumentSelection     `json:"selection,omitempty" api:"optional,nonnullable"`
	// useInputName 为 true 时只用非空 keyword 覆盖主键，其他默认模板配置仍然生效；省略时使用模板名称。
	UseInputName bool                   `json:"useInputName" api:"optional,nullable"`
	AvID         string                 `json:"avID" api:"trim"`
	BlockID      string                 `json:"blockID" api:"trim"`
	KeyID        string                 `json:"keyID" api:"trim"`
	Keyword      string                 `json:"keyword" api:"optional,nullable"`
	Cells        []*AVRelationItemCell  `json:"cells"`
	Preview      *AVRelationItemPreview `json:"preview"`
	App          string                 `json:"app" api:"optional,nullable"`
	Session      string                 `json:"session" api:"optional,nullable"`
}

type AVRelationItemCell struct {
	ItemID         string   `json:"itemID"`
	RelatedItemIDs []string `json:"relatedItemIDs"`
}

// 默认模板 ID、解析后的主键和解析时间；error 非空时只能选择已有条目，不能确认新建。
type AVRelationItemPreview struct {
	// 输入名称经过目标条目的标题规则解析后的主键，供新建入口展示实际名称。
	InputPrimaryKey string `json:"inputPrimaryKey" api:"optional,nullable"`
	// 是否配置主键模板，用于在模板名称与输入不同时展示两个新建入口。
	HasPrimaryKeyTemplate bool   `json:"hasPrimaryKeyTemplate,omitempty" api:"optional,nullable"`
	TemplateID            string `json:"templateID"`
	PrimaryKey            string `json:"primaryKey"`
	CreatedAt             int64  `json:"createdAt"`
	Error                 string `json:"error,omitempty" api:"optional,nullable"`
}

type CreateAttributeViewItemWithMarkdownRequest struct {
	Selection    *DocumentSelection `json:"selection,omitempty" api:"optional,nonnullable"`
	AvID         string             `json:"avID" api:"trim"`
	BlockID      string             `json:"blockID" api:"trim"`
	ViewID       string             `json:"viewID" api:"optional,nullable"`
	TemplateID   string             `json:"templateID" api:"trim"`
	PreviousID   string             `json:"previousID" api:"optional,nullable"`
	GroupID      string             `json:"groupID" api:"optional,nullable"`
	Title        string             `json:"title" api:"trim"`
	Markdown     string             `json:"markdown"`
	Tags         string             `json:"tags" api:"optional,nullable"`
	WithMath     bool               `json:"withMath" api:"optional,nullable"`
	ClippingHref string             `json:"clippingHref" api:"optional,nullable"`
	ListDocTree  bool               `json:"listDocTree" api:"optional,nullable"`
	App          string             `json:"app" api:"optional,nullable"`
	Session      string             `json:"session" api:"optional,nullable"`
}

// 新建文档继承游离条目已设置的图标；条目未设置图标时沿用文档模板图标。
type CreateAttributeViewItemDocsRequest struct {
	Selection *DocumentSelection `json:"selection,omitempty" api:"optional,nonnullable"`
	AvID      string             `json:"avID"`
	BlockID   string             `json:"blockID"`
	SaveMode  string             `json:"saveMode"`
	ItemIDs   []string           `json:"itemIDs" api:"filterstrings"`
	App       string             `json:"app" api:"optional,nullable"`
	Session   string             `json:"session" api:"optional,nullable"`
}

type SearchAttributeViewRequest struct {
	Keyword            string   `json:"keyword"`
	AvID               string   `json:"avID" api:"optional,nullable"`
	BlockID            string   `json:"blockID" api:"optional,nullable"`
	Excludes           []string `json:"excludes" api:"optional,nullable"`
	IncludeViewMatches bool     `json:"includeViewMatches" api:"optional,nullable"`
}

type RenderSnapshotAttributeViewRequest struct {
	Page        *float64                  `json:"page" api:"optional,nullable"`
	PageSize    *float64                  `json:"pageSize" api:"optional,nullable"`
	Query       string                    `json:"query" api:"optional,nullable"`
	GroupPaging map[string]*AVGroupPaging `json:"groupPaging" api:"optional,nullable"`
	Nested      *AVNestedRequest          `json:"nested" api:"optional,nullable"`
	// 仅限制本次快照中的日历渲染范围，语义见 AVCalendarRange；不修改快照及共享视图。
	CalendarRange *AVCalendarRange `json:"calendarRange" api:"optional,nullable"`
	Snapshot      string           `json:"snapshot"`
	ID            string           `json:"id"`
	BlockID       string           `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID        string           `json:"viewID" api:"optional,nullable,ignoretype"`
	CarrierViewID string           `json:"carrierViewID" api:"optional,nullable,ignoretype"`
}

type RenderHistoryAttributeViewRequest struct {
	Nested *AVNestedRequest `json:"nested" api:"optional,nullable"`
	// 仅限制本次历史版本中的日历渲染范围，语义见 AVCalendarRange；不修改历史及共享视图。
	CalendarRange *AVCalendarRange          `json:"calendarRange" api:"optional,nullable"`
	ID            string                    `json:"id"`
	Created       string                    `json:"created"`
	BlockID       string                    `json:"blockID" api:"optional,nullable"`
	ViewID        string                    `json:"viewID" api:"optional,nullable"`
	CarrierViewID string                    `json:"carrierViewID" api:"optional,nullable,ignoretype"`
	Page          *float64                  `json:"page" api:"optional,nullable"`
	PageSize      *float64                  `json:"pageSize" api:"optional,nullable"`
	Query         string                    `json:"query" api:"optional,nullable"`
	GroupPaging   map[string]*AVGroupPaging `json:"groupPaging" api:"optional,nullable"`
}

type RenderAttributeViewRequest struct {
	// 首屏返回尚未联网的视图及待加载字段；默认 false，不影响现有同步调用。
	DeferHTTPTemplates bool `json:"deferHTTPTemplates" api:"optional,nullable"`
	// 仅在 automaticRefresh 为 true 的展示操作中复用外部查询依赖模板的当前快照。
	PreserveHTTPResults bool `json:"preserveHTTPResults" api:"optional,nullable"`
	// 自动重渲复用来源、行及模板输入未变的内存结果；默认 false，显式刷新重新求值。
	AutomaticRefresh bool `json:"automaticRefresh" api:"optional,nullable"`
	// 从来源关联字段推导目标及条目集合；无效上下文报错，不能回退为整个数据库。
	// blockID 为真实来源数据库载体或来源条目绑定块；游离上下文可省略。
	RelationContext *AVRelationContext `json:"relationContext" api:"optional,nullable"`
	// 与已有视图筛选相交，只影响关联明细面板本次渲染。
	TemporaryFilters []*AVViewFilter  `json:"temporaryFilters" api:"optional,nullable"`
	Nested           *AVNestedRequest `json:"nested" api:"optional,nullable"`
	TemporarySort    *AVViewSort      `json:"temporarySort" api:"optional,nullable"`
	// 仅限制本次日历渲染范围，语义见 AVCalendarRange；无效区间返回错误，不修改已存数据。
	// 发布读取保留权限过滤；日期范围和定位参数不扩大条目访问权限。
	CalendarRange    *AVCalendarRange          `json:"calendarRange" api:"optional,nullable"`
	ID               string                    `json:"id"`
	BlockID          string                    `json:"blockID" api:"optional,nullable"`
	ViewID           string                    `json:"viewID" api:"optional,nullable"`
	Page             *float64                  `json:"page" api:"optional,nullable"`
	PageSize         *float64                  `json:"pageSize" api:"optional,nullable"`
	Query            string                    `json:"query" api:"optional,nullable"`
	GroupPaging      map[string]*AVGroupPaging `json:"groupPaging" api:"optional,nullable"`
	InitialLayout    string                    `json:"initialLayout" api:"optional,nullable,ignoretype"`
	CreateIfNotExist *bool                     `json:"createIfNotExist" api:"optional,nullable"`
	IgnoreRows       bool                      `json:"ignoreRows" api:"optional,nullable"`
	TargetItemID     string                    `json:"targetItemID" api:"optional,nullable"`
	TargetGroupID    string                    `json:"targetGroupID" api:"optional,nullable"`
}

type AVRelationContext struct {
	SourceAvID    string `json:"sourceAvID"`
	SourceItemID  string `json:"sourceItemID"`
	RelationKeyID string `json:"relationKeyID"`
}

// AVRelationCellContext 授权明细表中现有成员的关联单元格读取与新建，不要求该单元格字段启用明细视图。
// sourceItemIDs 不得为空、重复或包含非当前成员；内核从根关系推导目标表和实际关联目标，不接受存储域参数。
type AVRelationCellContext struct {
	RelationContext AVRelationContext `json:"relationContext"`
	SourceItemIDs   []string          `json:"sourceItemIDs"`
}

// AVRelationItemsChange 在事务内读取当前关系后应用增量；移除关系不删除目标条目。
// 启用子级条目时，父项字段只接受一个新增目标，并替换执行时的当前父项；普通关联与子项字段仍增量合并。
type AVRelationItemsChange struct {
	AddItemIDs    []string `json:"addItemIDs"`
	RemoveItemIDs []string `json:"removeItemIDs"`
}

// AVCalendarUndatedRequest 只读取普通日期字段为空的条目，不修改视图或数据库。
// 绑定带显示模板的日期字段时返回空列表，计算日期需要通过模板或来源字段调整。
// query 沿用当前视图搜索，search 仅匹配待安排条目的标题；页码从 1 开始，页大小默认 50，最大 100。
// 端点仅供可编辑用户使用，并按 blockID 保持加密笔记本读取租约。
type AVCalendarUndatedRequest struct {
	ID       string   `json:"id"`
	BlockID  string   `json:"blockID" api:"optional,nullable"`
	ViewID   string   `json:"viewID"`
	Query    string   `json:"query" api:"optional,nullable"`
	Search   string   `json:"search" api:"optional,nullable"`
	Page     *float64 `json:"page" api:"optional,nullable"`
	PageSize *float64 `json:"pageSize" api:"optional,nullable"`
}

type GetCurrentAttrViewImagesRequest struct {
	ID      string `json:"id"`
	BlockID string `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID  string `json:"viewID" api:"optional,nullable"`
	Query   string `json:"query" api:"optional,nullable"`
	GroupID string `json:"groupID" api:"optional,nullable"`
}

type GetAttributeViewKeysRequest struct {
	// 语义同 RenderAttributeViewRequest.AutomaticRefresh，不改变字段或条目的读取权限。
	AutomaticRefresh bool   `json:"automaticRefresh" api:"optional,nullable"`
	ID               string `json:"id" api:"optional,nullable,ignoretype"`
	AvID             string `json:"avID" api:"optional,nullable,ignoretype"`
	ItemID           string `json:"itemID" api:"optional,nullable,ignoretype"`
	ValueID          string `json:"valueID" api:"optional,nullable,ignoretype"`
	// BlockID 配合 RelationContext 指向来源载体；单独提供时必须是 AvID 的真实数据库载体。
	BlockID string `json:"blockID" api:"optional,nullable"`
	// RelationContext 限定读取当前关联成员，目标和笔记本只能由已验证的来源关系推导。
	RelationContext *AVRelationContext `json:"relationContext" api:"optional,nullable"`
}

type GetAttributeViewSearchTargetRequest struct {
	ID       string   `json:"id" api:"optional,nullable,ignoretype"`
	Keywords []string `json:"keywords" api:"optional,nullable,filterstrings"`
}

type GetAttributeViewBacklinksRequest struct {
	ID      string `json:"id" api:"optional,nullable,ignoretype"`
	AvID    string `json:"avID" api:"optional,nullable,ignoretype"`
	ItemID  string `json:"itemID" api:"optional,nullable,ignoretype"`
	ValueID string `json:"valueID" api:"optional,nullable,ignoretype"`
	// BlockID 指定目标数据库真实载体，仅在其存储边界内读取条目反向关联。
	BlockID string `json:"blockID" api:"optional,nullable"`
}

// SetAttributeViewBlockAttrRequest 字段实际改变时触发数据库自动化，返回联动完成后的字段值。
type SetAttributeViewBlockAttrRequest struct {
	AvID   string       `json:"avID"`
	KeyID  string       `json:"keyID"`
	ItemID *string      `json:"itemID" api:"optional,nullable"`
	RowID  *string      `json:"rowID" api:"optional,nullable"`
	Value  AVValuePatch `json:"value"`
}

// BatchSetAttributeViewBlockAttrsRequest 整批更新完成后求值自动化，同一条目每条规则最多触发一次。
type BatchSetAttributeViewBlockAttrsRequest struct {
	AvID   string         `json:"avID"`
	Values []AVCellUpdate `json:"values"`
}

type GetAttributeViewRowSortRequest struct {
	AvID       string   `json:"avID" api:"optional,nullable"`
	BlockID    string   `json:"blockID" api:"optional,nullable"`
	ViewID     string   `json:"viewID" api:"optional,nullable"`
	GroupID    string   `json:"groupID" api:"optional,nullable"`
	ItemIDs    []string `json:"itemIDs" api:"optional,nullable"`
	PreviousID string   `json:"previousID" api:"optional,nullable"`
	NextID     string   `json:"nextID" api:"optional,nullable"`
}
