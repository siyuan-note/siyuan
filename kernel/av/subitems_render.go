package av

// NestedRequest 只控制本次树形读取，不修改持久化展开状态。
type NestedRequest struct {
	ExpandedIDs      []string               `json:"expandedIDs,omitempty"`
	GroupExpandedIDs map[string][]string    `json:"groupExpandedIDs,omitempty"`
	ChildPaging      map[string]*NestedPage `json:"childPaging,omitempty"`
}

type NestedPage struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

type NestedChildPage struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
	Total    int `json:"total"`
	Loaded   int `json:"loaded"`
}

// NestedResult 区分根分页、匹配数量及展开节点的子项分页。
type NestedResult struct {
	Page         int                         `json:"page"`
	PageSize     int                         `json:"pageSize"`
	RootCount    int                         `json:"rootCount"`
	RootLoaded   int                         `json:"rootLoaded"`
	MatchedCount int                         `json:"matchedCount"`
	ChildPaging  map[string]*NestedChildPage `json:"childPaging"`
}

type ItemHierarchy struct {
	ParentID   string `json:"parentID,omitempty"`
	Depth      int    `json:"depth"`
	ChildCount int    `json:"childCount"`
	Context    bool   `json:"context"`
	Expanded   bool   `json:"expanded"`
}
