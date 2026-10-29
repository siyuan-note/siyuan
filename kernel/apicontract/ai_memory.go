package apicontract

// AIMemorySource 是可追溯来源；正文证据仅在管理员管理接口返回。
type AIMemorySource struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Revision string `json:"revision"`
	Evidence string `json:"evidence"`
}

type AIMemoryRecord struct {
	Confirmed  string `json:"confirmed"`
	ValidFrom  string `json:"validFrom"`
	ValidUntil string `json:"validUntil"`
	Reason     string `json:"reason"`
	Supersedes string `json:"supersedes"`

	ID       string           `json:"id"`
	Kind     string           `json:"kind"`
	Subject  string           `json:"subject"`
	Scope    string           `json:"scope"`
	State    string           `json:"state"`
	Content  string           `json:"content"`
	Sources  []AIMemorySource `json:"sources"`
	Created  string           `json:"created"`
	Updated  string           `json:"updated"`
	Revision string           `json:"revision"`
}
type AIMemoryListRequest struct {
	Query  string `json:"query" api:"optional"`
	Offset int    `json:"offset" api:"optional"`
	Limit  int    `json:"limit" api:"optional"`
}
type AIMemoryListData struct {
	Tasks      []AIMemoryTaskData `json:"tasks"`
	Records    []AIMemoryRecord   `json:"records"`
	Incomplete bool               `json:"incomplete"`
	Errors     []string           `json:"errors"`
}
type AIMemoryGetRequest struct {
	ID string `json:"id"`
}
type AIMemoryGetData struct {
	Record   AIMemoryRecord `json:"record"`
	Revision string         `json:"revision"`
}
type AIMemorySaveRequest struct {
	ID          string `json:"id" api:"optional"`
	Revision    string `json:"revision"`
	OperationID string `json:"operationId"`
	Content     string `json:"content"`
	Kind        string `json:"kind"`
	Subject     string `json:"subject"`
	Scope       string `json:"scope"`
	State       string `json:"state"`
}
type AIMemorySaveData struct {
	ID              string `json:"id"`
	Revision        string `json:"revision"`
	Saved           bool   `json:"saved"`
	OverviewPending bool   `json:"overviewPending"`
}
type AIMemoryForgetRequest struct {
	ID          string `json:"id"`
	Revision    string `json:"revision"`
	OperationID string `json:"operationId"`
}
type AIMemoryForgetData struct {
	Saved          bool `json:"saved"`
	CleanupPending bool `json:"cleanupPending"`
}
type AIMemoryOverviewData struct {
	User   string `json:"user"`
	Memory string `json:"memory"`
	Stale  bool   `json:"stale"`
}
type AIMemoryMaintainRequest struct {
	Text        string   `json:"text"`
	SourceIDs   []string `json:"sourceIDs" api:"optional"`
	OperationID string   `json:"operationId"`
}
type AIMemoryTaskRequest struct {
	TaskID string `json:"taskId"`
}
type AIMemoryTaskStarted struct {
	TaskID string `json:"taskId"`
}
type AIMemoryTaskResult struct {
	ID    string `json:"id"`
	Saved bool   `json:"saved"`
	Error string `json:"error"`
}
type AIMemoryTaskData struct {
	TaskID          string               `json:"taskId"`
	State           string               `json:"state"`
	Results         []AIMemoryTaskResult `json:"results"`
	Error           string               `json:"error"`
	OverviewPending bool                 `json:"overviewPending"`
}
type AIMemoryCapabilitiesData struct {
	Efforts []string `json:"efforts"`
}
