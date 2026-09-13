package apicontract

type Bookmark struct {
	Name   string         `json:"name"`
	Blocks []*SearchBlock `json:"blocks"`
	Type   string         `json:"type"`
	Depth  int            `json:"depth"`
	Count  int            `json:"count"`
}
