package apicontract

// 全局反链的分页快照仅固定条目次序，正文始终通过独立请求读取。
type GlobalBacklinkQuery struct {
	ID              string                `json:"id"`
	Notebook        string                `json:"notebook" api:"optional"`
	Keyword         string                `json:"keyword" api:"optional"`
	Sort            int                   `json:"sort"` // 1 自然升序，2 自然降序
	ContainChildren bool                  `json:"containChildren"`
	SourceFilter    *BacklinkSourceFilter `json:"sourceFilter" api:"optional"`
}

type GlobalBacklinkListRequest struct {
	GlobalBacklinkQuery
	Snapshot string `json:"snapshot" api:"optional"`
	Offset   int    `json:"offset" api:"optional"`
	AnchorID string `json:"anchorID" api:"optional"`
}

type GlobalBacklinkItem struct {
	ID     string `json:"id"`
	RootID string `json:"rootID"`
	Box    string `json:"box"`
	HPath  string `json:"hPath"`
	Anchor string `json:"anchor"`
}

type GlobalBacklinkListData struct {
	Snapshot string                `json:"snapshot"`
	Expired  bool                  `json:"expired"`
	Offset   int                   `json:"offset"`
	Total    int                   `json:"total"`
	Items    []*GlobalBacklinkItem `json:"items"`
}

type GlobalBacklinkContextRequest struct {
	GlobalBacklinkQuery
	Snapshot string   `json:"snapshot"`
	IDs      []string `json:"ids"`
}

type GlobalBacklinkContextData struct {
	Expired bool               `json:"expired"`
	Items   []*BacklinkContext `json:"items"`
}
