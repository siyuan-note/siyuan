package apicontract

// AISkillFileRequest 使用工作空间技能目录内的相对路径，保留 UTF-8 文本原文和版本。
type AISkillFileRequest struct {
	Action   string `json:"action"`
	Path     string `json:"path" api:"optional"`
	Target   string `json:"target" api:"optional"`
	Content  string `json:"content" api:"optional"`
	Revision string `json:"revision" api:"optional"`
}

type AISkillFileEntry struct {
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	// Editable 表示文件是技能内不超过 8 MiB 的 UTF-8 文本；读取时会重新检测。
	Editable bool `json:"editable"`
}

type AISkillFileData struct {
	Entries  *[]AISkillFileEntry `json:"entries,omitempty"`
	Content  *string             `json:"content,omitempty"`
	Revision string              `json:"revision,omitempty"`
	// ReadOnlyReason 说明读取时不能编辑正文的原因；此时不返回 Content，仍保留 Revision。
	ReadOnlyReason string `json:"readOnlyReason,omitempty" api:"enum=binary|encoding|tooLarge"`
}
