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
	ID      string   `json:"id"`
	BlockID string   `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID  string   `json:"viewID" api:"optional,nullable,ignoretype"`
	Query   string   `json:"query" api:"optional,nullable,ignoretype"`
	ItemIDs []string `json:"itemIDs"`
}

type GetAttributeViewAddingBlockDefaultValuesRequest struct {
	AvID          string `json:"avID"`
	BlockID       string `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID        string `json:"viewID" api:"optional,nullable"`
	GroupID       string `json:"groupID" api:"optional,nullable"`
	PreviousID    string `json:"previousID" api:"optional,nullable"`
	AddingBlockID string `json:"addingBlockID" api:"optional,nullable"`
}

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
	KeyID   string `json:"keyID" api:"optional,nullable,ignoretype"`
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
}

type GetAttributeViewRelationCandidatesRequest struct {
	AvID             string   `json:"avID" api:"optional,nullable,ignoretype"`
	KeyID            string   `json:"keyID" api:"optional,nullable,ignoretype"`
	ID               string   `json:"id" api:"optional,nullable,ignoretype"`
	Keyword          string   `json:"keyword" api:"optional,nullable"`
	Page             *float64 `json:"page" api:"optional,nullable"`
	PageSize         *float64 `json:"pageSize" api:"optional,nullable"`
	SelectedBlockIDs []string `json:"selectedBlockIDs" api:"optional,nullable,filterstrings"`
}

type AppendAttributeViewDetachedBlocksWithValuesRequest struct {
	AvID         string       `json:"avID"`
	BlocksValues [][]*AVValue `json:"blocksValues"`
}

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
}

type GetAttributeViewPasteRowsRequest struct {
	AvID        string  `json:"avID" api:"trim"`
	BlockID     string  `json:"blockID" api:"trim"`
	ViewID      string  `json:"viewID" api:"optional,nullable"`
	GroupID     string  `json:"groupID" api:"optional,nullable"`
	Query       string  `json:"query" api:"optional,nullable"`
	StartItemID string  `json:"startItemID" api:"trim"`
	Count       float64 `json:"count"`
}

type GetAttributeViewFieldViewsRequest struct {
	AvID  string `json:"avID" api:"trim"`
	KeyID string `json:"keyID" api:"trim"`
}

type CreateAttributeViewItemRequest struct {
	// 日历新条目的全天日期，单位为毫秒；仅支持绑定普通 date 字段的日历视图。
	// 覆盖模板中该字段的值，与模板其他字段及条目创建共用一个可撤销事务。
	// 绑定 created 或 updated 时拒绝指定日期；省略或传 null 时沿用常规创建流程。
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

type CreateAttributeViewItemWithMarkdownRequest struct {
	AvID         string `json:"avID" api:"trim"`
	BlockID      string `json:"blockID" api:"trim"`
	ViewID       string `json:"viewID" api:"optional,nullable"`
	TemplateID   string `json:"templateID" api:"trim"`
	PreviousID   string `json:"previousID" api:"optional,nullable"`
	GroupID      string `json:"groupID" api:"optional,nullable"`
	Title        string `json:"title" api:"trim"`
	Markdown     string `json:"markdown"`
	Tags         string `json:"tags" api:"optional,nullable"`
	WithMath     bool   `json:"withMath" api:"optional,nullable"`
	ClippingHref string `json:"clippingHref" api:"optional,nullable"`
	ListDocTree  bool   `json:"listDocTree" api:"optional,nullable"`
	App          string `json:"app" api:"optional,nullable"`
	Session      string `json:"session" api:"optional,nullable"`
}

type CreateAttributeViewItemDocsRequest struct {
	AvID     string   `json:"avID"`
	BlockID  string   `json:"blockID"`
	SaveMode string   `json:"saveMode"`
	ItemIDs  []string `json:"itemIDs" api:"filterstrings"`
	App      string   `json:"app" api:"optional,nullable"`
	Session  string   `json:"session" api:"optional,nullable"`
}

type SearchAttributeViewRequest struct {
	Keyword            string   `json:"keyword"`
	AvID               string   `json:"avID" api:"optional,nullable"`
	BlockID            string   `json:"blockID" api:"optional,nullable"`
	Excludes           []string `json:"excludes" api:"optional,nullable"`
	IncludeViewMatches bool     `json:"includeViewMatches" api:"optional,nullable"`
}

type RenderSnapshotAttributeViewRequest struct {
	// 仅限制本次快照中的日历渲染范围，语义见 AVCalendarRange；不修改快照及共享视图。
	CalendarRange *AVCalendarRange `json:"calendarRange" api:"optional,nullable"`
	Snapshot      string           `json:"snapshot"`
	ID            string           `json:"id"`
	BlockID       string           `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID        string           `json:"viewID" api:"optional,nullable,ignoretype"`
	CarrierViewID string           `json:"carrierViewID" api:"optional,nullable,ignoretype"`
}

type RenderHistoryAttributeViewRequest struct {
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

type GetCurrentAttrViewImagesRequest struct {
	ID      string `json:"id"`
	BlockID string `json:"blockID" api:"optional,nullable,ignoretype"`
	ViewID  string `json:"viewID" api:"optional,nullable"`
	Query   string `json:"query" api:"optional,nullable"`
}

type GetAttributeViewKeysRequest struct {
	ID      string `json:"id" api:"optional,nullable,ignoretype"`
	AvID    string `json:"avID" api:"optional,nullable,ignoretype"`
	ItemID  string `json:"itemID" api:"optional,nullable,ignoretype"`
	ValueID string `json:"valueID" api:"optional,nullable,ignoretype"`
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
}

type SetAttributeViewBlockAttrRequest struct {
	AvID   string       `json:"avID"`
	KeyID  string       `json:"keyID"`
	ItemID *string      `json:"itemID" api:"optional,nullable"`
	RowID  *string      `json:"rowID" api:"optional,nullable"`
	Value  AVValuePatch `json:"value"`
}

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
