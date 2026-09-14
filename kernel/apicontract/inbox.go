package apicontract

type RemoveShorthandsRequest struct {
	IDs []string `json:"ids"`
}

type ShorthandsRequest struct {
	Page float64 `json:"page"`
}

type Shorthand struct {
	ID          string `json:"oId"`
	Content     string `json:"shorthandContent"`
	Markdown    string `json:"shorthandMd"`
	Description string `json:"shorthandDesc"`
	From        int    `json:"shorthandFrom"`
	Title       string `json:"shorthandTitle"`
	URL         string `json:"shorthandURL"`
	Created     string `json:"hCreated"`
}

type ShorthandPagination struct {
	PageCount   int   `json:"paginationPageCount"`
	RecordCount int   `json:"paginationRecordCount"`
	PageNums    []int `json:"paginationPageNums"`
}

type ShorthandPage struct {
	Pagination ShorthandPagination `json:"pagination"`
	Shorthands []*Shorthand        `json:"shorthands" api:"nonnullable"`
}

type ShorthandsData struct {
	Code int           `json:"code"`
	Msg  string        `json:"msg"`
	Data ShorthandPage `json:"data"`
}
