package apicontract

type TrimmedIDRequest struct {
	ID string `json:"id" api:"trim"`
}

type NetImageAssetsRequest struct {
	ID  string `json:"id" api:"trim"`
	URL string `json:"url" api:"optional,nullable"`
}
