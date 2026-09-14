package apicontract

// Base64Bytes 保留 JSON 字节切片的 Base64 字符串及数字数组输入。
type Base64Bytes []byte

type NotebookEncryptionPatch struct {
	Spec       *int        `json:"spec" api:"optional"`
	WrappedDEK Base64Bytes `json:"wrappedDEK" api:"optional,nullable"`
	WrapNonce  Base64Bytes `json:"wrapNonce" api:"optional,nullable"`
	Metadata   Base64Bytes `json:"metadata" api:"optional,nullable"`
	CreatedAt  *int64      `json:"createdAt" api:"optional"`
}

type NotebookConfPatch struct {
	Name                  *string                  `json:"name" api:"optional"`
	Sort                  *int                     `json:"sort" api:"optional"`
	Icon                  *string                  `json:"icon" api:"optional"`
	Closed                *bool                    `json:"closed" api:"optional"`
	RefCreateSaveBox      *string                  `json:"refCreateSaveBox" api:"optional"`
	RefCreateSavePath     *string                  `json:"refCreateSavePath" api:"optional"`
	DocCreateSaveBox      *string                  `json:"docCreateSaveBox" api:"optional"`
	DocCreateSavePath     *string                  `json:"docCreateSavePath" api:"optional"`
	DocCreateTemplatePath *string                  `json:"docCreateTemplatePath" api:"optional"`
	DailyNoteSavePath     *string                  `json:"dailyNoteSavePath" api:"optional"`
	DailyNoteTemplatePath *string                  `json:"dailyNoteTemplatePath" api:"optional"`
	SortMode              *int                     `json:"sortMode" api:"optional"`
	Encrypted             *bool                    `json:"encrypted" api:"optional"`
	BoxCrypt              *NotebookEncryptionPatch `json:"boxCrypt" api:"optional"`
}

type SetNotebookConfRequest struct {
	Notebook string             `json:"notebook"`
	Conf     *NotebookConfPatch `json:"conf" api:"optional,legacyobject"`
}
