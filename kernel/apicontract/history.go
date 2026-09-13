package apicontract

type HistoryPathRequest struct {
	HistoryPath string `json:"historyPath" api:"trim"`
}

type CreateDocHistoryRequest struct {
	ID string `json:"id" api:"trim"`
}

type CreateAssetHistoryRequest struct {
	Path string `json:"path" api:"trim"`
}

type DocHistoryContentRequest struct {
	HistoryPath string `json:"historyPath" api:"trim"`
	K           string `json:"k" api:"optional,nullable"`
	Highlight   *bool  `json:"highlight" api:"optional"`
}

type DocHistoryContentData struct {
	ID         string `json:"id"`
	RootID     string `json:"rootID"`
	Content    string `json:"content"`
	IsLargeDoc bool   `json:"isLargeDoc"`
}

type HistoryItemsRequest struct {
	Created  string   `json:"created" api:"trim"`
	Notebook string   `json:"notebook" api:"optional,nullable"`
	Query    string   `json:"query" api:"optional,nullable"`
	Op       string   `json:"op" api:"optional,nullable"`
	Type     *float64 `json:"type" api:"optional"`
}

type HistoryItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Path     string `json:"path"`
	Op       string `json:"op"`
	Notebook string `json:"notebook"`
}

type History struct {
	HCreated string         `json:"hCreated"`
	Items    []*HistoryItem `json:"items"`
}

type HistoryItemsData struct {
	Items []*HistoryItem `json:"items"`
}

type NotebookHistoryData struct {
	Histories []*History `json:"histories"`
}
