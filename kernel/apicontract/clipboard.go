package apicontract

type ClipboardFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	Updated int64  `json:"updated"`
	Path    string `json:"path"`
}

type ClipboardPathRequest struct {
	Path string `json:"path" api:"trim"`
}

type RichClipboardAsset struct {
	Index int    `json:"index"`
	Path  string `json:"path" api:"trim"`
	Box   string `json:"box" api:"optional,trim"`
}

type PrepareRichTextRequest struct {
	Assets []RichClipboardAsset `json:"assets"`
}

type CleanupRichTextRequest struct {
	Batch  string   `json:"batch" api:"trim"`
	Groups []string `json:"groups"`
}

type RichClipboardPreparedAsset struct {
	Index int    `json:"index"`
	Path  string `json:"path"`
}

type RichClipboardPrepared struct {
	Batch  string                       `json:"batch"`
	Groups []string                     `json:"groups"`
	Assets []RichClipboardPreparedAsset `json:"assets"`
}
