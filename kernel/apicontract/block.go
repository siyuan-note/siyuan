package apicontract

type ChildBlock struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	SubType  string `json:"subType,omitempty"`
	Content  string `json:"content,omitempty"`
	Markdown string `json:"markdown,omitempty"`
}

type TailChildBlocksRequest struct {
	BlockQueryRequest
	N *float64 `json:"n" api:"optional"`
}

type CheckBlocksExistRequest struct {
	IDs      []JSONValue `json:"ids"`
	Notebook string      `json:"notebook" api:"optional,nullable,ignoretype"`
	ID       string      `json:"id" api:"optional,nullable,ignoretype"`
}

type OrderedListStartData struct {
	Start int  `json:"start"`
	Found bool `json:"found"`
}

type ContentWordCountRequest struct {
	Content string    `json:"content"`
	ReqID   JSONValue `json:"reqId" api:"optional,nullable"`
}

type BlocksWordCountRequest struct {
	BlocksQueryRequest
	ReqID JSONValue `json:"reqId" api:"optional,nullable"`
}

type WordCountData struct {
	ReqID JSONValue  `json:"reqId"`
	Stat  *BlockStat `json:"stat"`
}

type BlockStat struct {
	RuneCount  int `json:"runeCount"`
	WordCount  int `json:"wordCount"`
	LinkCount  int `json:"linkCount"`
	ImageCount int `json:"imageCount"`
	RefCount   int `json:"refCount"`
	BlockCount int `json:"blockCount"`
}

type BlockDOMData struct {
	ID  string `json:"id"`
	DOM string `json:"dom"`
}

type BlockKramdownData struct {
	ID       string `json:"id"`
	Kramdown string `json:"kramdown"`
}

type BlockKramdownRequest struct {
	BlockQueryRequest
	Mode *string `json:"mode" api:"optional"`
}

type BlocksKramdownRequest struct {
	BlocksQueryRequest
	Mode *string `json:"mode" api:"optional"`
}

type BlockQueryRequest struct {
	ID       string   `json:"id"`
	Notebook string   `json:"notebook" api:"optional,nullable,ignoretype"`
	IDs      []string `json:"ids" api:"optional,filterstrings"`
}

type BlocksQueryRequest struct {
	IDs      []string `json:"ids"`
	Notebook string   `json:"notebook" api:"optional,nullable,ignoretype"`
	ID       string   `json:"id" api:"optional,nullable,ignoretype"`
}

type BlockSiblingData struct {
	Parent   string `json:"parent"`
	Next     string `json:"next"`
	Previous string `json:"previous"`
}

type BlockRelevantData struct {
	ParentID   string `json:"parentID"`
	PreviousID string `json:"previousID"`
	NextID     string `json:"nextID"`
}

type UnfoldedParentData struct {
	ParentID string `json:"parentID"`
}

type BlockFoldData struct {
	IsFolded bool `json:"isFolded"`
	IsRoot   bool `json:"isRoot"`
}

type HeadingChildrenRequest struct {
	ID             string `json:"id"`
	RemoveFoldAttr *bool  `json:"removeFoldAttr" api:"optional"`
}

type AppendHeadingChildrenRequest struct {
	ID          string `json:"id"`
	ChildrenDOM string `json:"childrenDOM"`
}

type DocOrdersRequest struct {
	ID string `json:"id" api:"trim"`
}
