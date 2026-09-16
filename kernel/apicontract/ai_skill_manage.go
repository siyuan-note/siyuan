package apicontract

// AISkillFileRequest 使用工作空间技能目录内的相对路径，保留 Markdown 原文和版本。
type AISkillFileRequest struct {
	Action   string `json:"action"`
	Path     string `json:"path" api:"optional"`
	Target   string `json:"target" api:"optional"`
	Content  string `json:"content" api:"optional"`
	Revision string `json:"revision" api:"optional"`
}

type AISkillFileEntry struct {
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Editable bool   `json:"editable"`
}

type AISkillFileData struct {
	Entries  *[]AISkillFileEntry `json:"entries,omitempty"`
	Content  *string             `json:"content,omitempty"`
	Revision string              `json:"revision,omitempty"`
}
