package apicontract

// PreparePasteAssetsRequest 为加密笔记本中的粘贴创建独立附件副本，不修改源文件。
// assets 仅接受工作空间内的 assets/ 引用，可包含查询参数、片段和 PDF 标注 ID。
// 同一目标笔记本的附件直接复用，其他加密笔记本的附件拒绝跨边界复制。
// 目标必须已解锁；失败返回 code=-1、data=null，并清理本批次新建的附件。
// 成功返回原始引用到目标引用的映射，保留非 box 查询参数和片段。
type PreparePasteAssetsRequest struct {
	Notebook string   `json:"notebook" api:"trim"`
	Assets   []string `json:"assets"`
}

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
