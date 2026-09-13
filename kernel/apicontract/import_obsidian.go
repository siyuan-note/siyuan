package apicontract

type ObsidianAnalysisRequest struct {
	LocalPath string `json:"localPath" api:"trim"`
}

type ObsidianTaskRequest struct {
	TaskID string `json:"taskID" api:"trim"`
}

type ObsidianImportRequest struct {
	TaskID       string `json:"taskID" api:"trim"`
	NotebookName string `json:"notebookName" api:"trim"`
}

type ObsidianVaultAnalysis struct {
	VaultName               string   `json:"vaultName"`
	VaultPath               string   `json:"vaultPath"`
	NotebookName            string   `json:"notebookName"`
	MarkdownCount           int      `json:"markdownCount"`
	SyntheticParentCount    int      `json:"syntheticParentCount"`
	NameAdjustmentCount     int      `json:"nameAdjustmentCount"`
	ImportableAssetCount    int      `json:"importableAssetCount"`
	ImportableAssetSize     int64    `json:"importableAssetSize"`
	UnreferencedFileCount   int      `json:"unreferencedFileCount"`
	WikiLinkCount           int      `json:"wikiLinkCount"`
	EmbedCount              int      `json:"embedCount"`
	BlockIDCount            int      `json:"blockIDCount"`
	FootnoteCount           int      `json:"footnoteCount"`
	CommentCount            int      `json:"commentCount"`
	MissingCount            int      `json:"missingCount"`
	AmbiguousCount          int      `json:"ambiguousCount"`
	UnsupportedCount        int      `json:"unsupportedCount"`
	SkippedHiddenCount      int      `json:"skippedHiddenCount"`
	SkippedLinkCount        int      `json:"skippedLinkCount"`
	SkippedSpecialCount     int      `json:"skippedSpecialCount"`
	SkippedNestedVaultCount int      `json:"skippedNestedVaultCount"`
	BlockingErrors          []string `json:"blockingErrors"`
	Warnings                []string `json:"warnings"`
}

type ObsidianVaultImportResult struct {
	NotebookID               string `json:"notebookID"`
	NotebookName             string `json:"notebookName"`
	MarkdownCount            int    `json:"markdownCount"`
	SyntheticParentCount     int    `json:"syntheticParentCount"`
	NameAdjustmentCount      int    `json:"nameAdjustmentCount"`
	ImportedAttachmentCount  int    `json:"importedAttachmentCount"`
	UnreferencedFileCount    int    `json:"unreferencedFileCount"`
	ConvertedLinkCount       int    `json:"convertedLinkCount"`
	ConvertedEmbedCount      int    `json:"convertedEmbedCount"`
	ConvertedFootnoteCount   int    `json:"convertedFootnoteCount"`
	PreservedCommentCount    int    `json:"preservedCommentCount"`
	PreservedUnresolvedCount int    `json:"preservedUnresolvedCount"`
	SkippedPathCount         int    `json:"skippedPathCount"`
	Incomplete               bool   `json:"incomplete"`
	FailedStage              string `json:"failedStage,omitempty"`
}

type ObsidianVaultTask struct {
	TaskID   string                     `json:"taskID"`
	State    string                     `json:"state"`
	Progress int                        `json:"progress"`
	Message  string                     `json:"message"`
	Error    string                     `json:"error,omitempty"`
	Detail   string                     `json:"detail,omitempty"`
	Analysis *ObsidianVaultAnalysis     `json:"analysis,omitempty"`
	Result   *ObsidianVaultImportResult `json:"result,omitempty"`
}
