package apicontract

type CopyStdMarkdownRequest struct {
	ID                         string `json:"id"`
	AssetsDestSpace2Underscore bool   `json:"assetsDestSpace2Underscore" api:"optional,nullable"`
	FillCSSVar                 bool   `json:"fillCSSVar" api:"optional,nullable"`
	AdjustHeadingLevel         bool   `json:"adjustHeadingLevel" api:"optional,nullable"`
	ImgTag                     bool   `json:"imgTag" api:"optional,nullable"`
}
type MarkdownHTMLRequest struct {
	Markdown string `json:"markdown"`
	Mode     string `json:"mode" api:"optional,nullable"`
}
type HTMLData struct {
	HTML string `json:"html"`
}
type DOMData struct {
	DOM string `json:"dom"`
}
