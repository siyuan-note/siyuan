package apicontract

type PinnedDoc struct {
	ID               string `json:"id"`
	Notebook         string `json:"notebook"`
	Name             string `json:"name"`
	Path             string `json:"path"`
	Icon             string `json:"icon"`
	SubFileCount     int    `json:"subFileCount"`
	Unavailable      bool   `json:"unavailable"`
	ChildrenSortMode *int   `json:"childrenSortMode"`
}

type UpdatePinnedDocsRequest struct {
	IDs      []string `json:"ids"`
	Action   string   `json:"action"`
	TargetID string   `json:"targetID" api:"optional"`
	After    bool     `json:"after" api:"optional"`
}
