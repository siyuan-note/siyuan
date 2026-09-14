package apicontract

type BlockTreeInfo struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	ParentID     string `json:"parentID"`
	ParentType   string `json:"parentType"`
	PreviousID   string `json:"previousID"`
	PreviousType string `json:"previousType"`
	NextID       string `json:"nextID"`
	NextType     string `json:"nextType"`
}

type BlockPath struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Type        string       `json:"type"`
	SubType     string       `json:"subType"`
	Children    []*BlockPath `json:"children"`
	HasChildren bool         `json:"hasChildren,omitempty"`
}

type BlockBreadcrumbChildren struct {
	Items   []*BlockPath `json:"items"`
	HasMore bool         `json:"hasMore"`
}

type BlockBreadcrumbRequest struct {
	BlockQueryRequest
	ExcludeTypes []string `json:"excludeTypes" api:"optional,nullable"`
}

type BlockBreadcrumbChildrenRequest struct {
	BlockBreadcrumbRequest
	Offset *float64 `json:"offset" api:"optional"`
	Limit  *float64 `json:"limit" api:"optional"`
}
