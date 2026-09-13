package apicontract

type Snippet struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Type              string `json:"type"`
	Enabled           bool   `json:"enabled"`
	DisabledInPublish bool   `json:"disabledInPublish" api:"optional,nullable"`
	Content           string `json:"content"`
}
type SnippetsData struct {
	Snippets []*Snippet `json:"snippets" api:"nonnullable"`
}
type GetSnippetRequest struct {
	Type    string  `json:"type" api:"trim"`
	Enabled float64 `json:"enabled"`
	Keyword string  `json:"keyword" api:"optional,nullable"`
}
type SetSnippetRequest struct {
	Snippets []Snippet `json:"snippets"`
}
