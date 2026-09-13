package apicontract

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
