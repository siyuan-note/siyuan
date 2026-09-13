package apicontract

type SearchBlock struct {
	Box        string            `json:"box"`
	Path       string            `json:"path"`
	HPath      string            `json:"hPath"`
	ID         string            `json:"id"`
	RootID     string            `json:"rootID"`
	ParentID   string            `json:"parentID"`
	Name       string            `json:"name"`
	Alias      string            `json:"alias"`
	Memo       string            `json:"memo"`
	Tag        string            `json:"tag"`
	Content    string            `json:"content"`
	Number     string            `json:"number,omitempty"`
	FContent   string            `json:"fcontent"`
	Markdown   string            `json:"markdown"`
	Folded     bool              `json:"folded"`
	Type       string            `json:"type"`
	SubType    string            `json:"subType"`
	RefText    string            `json:"refText"`
	Refs       []*SearchBlock    `json:"refs"`
	DefID      string            `json:"defID"`
	DefPath    string            `json:"defPath"`
	IAL        map[string]string `json:"ial"`
	Children   []*SearchBlock    `json:"children"`
	Depth      int               `json:"depth"`
	Count      int               `json:"count"`
	RefCount   int               `json:"refCount"`
	Sort       int               `json:"sort"`
	Created    string            `json:"created"`
	Updated    string            `json:"updated"`
	RiffCardID string            `json:"riffCardID"`
	RiffCard   *SearchBlockCard  `json:"riffCard"`
}

type SearchBlockCard struct {
	Due        string `json:"due"`
	Reps       uint64 `json:"reps"`
	Lapses     uint64 `json:"lapses"`
	State      int    `json:"state"`
	LastReview string `json:"lastReview"`
}
