package apicontract

type DocInfo struct {
	ID           string            `json:"id"`
	RootID       string            `json:"rootID"`
	Name         string            `json:"name"`
	RefCount     int               `json:"refCount"`
	SubFileCount int               `json:"subFileCount"`
	RefIDs       []string          `json:"refIDs"`
	IAL          map[string]string `json:"ial"`
	Icon         string            `json:"icon"`
	AttrViews    []*DocAttrView    `json:"attrViews"`
}

type DocAttrView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DocsInfoRequest struct {
	IDs      []string `json:"ids"`
	RefCount bool     `json:"refCount"`
	AV       bool     `json:"av"`
}

type TreeStatRequest struct {
	BlockQueryRequest
	IncludeEmbed bool      `json:"includeEmbed" api:"optional,nullable"`
	ReqID        JSONValue `json:"reqId" api:"optional,nullable"`
}

type TreeStatData struct {
	ReqID         JSONValue   `json:"reqId"`
	Stat          *BlockStat  `json:"stat"`
	ContainsEmbed *bool       `json:"containsEmbed,omitempty"`
	StatWithEmbed **BlockStat `json:"statWithEmbed,omitempty"`
	EmbedStat     **EmbedStat `json:"embedStat,omitempty"`
}

type EmbedStat struct {
	Complete            bool `json:"complete"`
	QueryEmbedCount     int  `json:"queryEmbedCount"`
	JSEmbedCount        int  `json:"jsEmbedCount"`
	ResultCount         int  `json:"resultCount"`
	FailedQueryCount    int  `json:"failedQueryCount"`
	FailedResultCount   int  `json:"failedResultCount"`
	TruncatedQueryCount int  `json:"truncatedQueryCount"`
	CycleCount          int  `json:"cycleCount"`
	DepthLimitCount     int  `json:"depthLimitCount"`
}
