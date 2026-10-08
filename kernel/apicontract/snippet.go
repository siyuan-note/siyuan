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
	// Revision 是未筛选的完整片段列表版本，发布读者不返回该值。全量编辑请使用 type=all、enabled=2。
	Revision string `json:"revision,omitempty"`
}
type GetSnippetRequest struct {
	Type    string  `json:"type" api:"trim"`
	Enabled float64 `json:"enabled"`
	Keyword string  `json:"keyword" api:"optional,nullable"`
}
type SetSnippetRequest struct {
	Snippets []Snippet `json:"snippets"`
	// Revision 来自 getSnippet。提供时在同一临界区校验并保存；不匹配返回 code=-1、
	// msg="snippet revision conflict"，保留原列表。省略或 null 时保持历史全量覆盖行为。
	Revision *string `json:"revision" api:"optional,nullable"`
}
