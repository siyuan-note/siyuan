package apicontract

import "encoding/json"

type TemplateFileRequest struct {
	Action   string `json:"action" api:"optional"`
	Path     string `json:"path" api:"optional"`
	Target   string `json:"target" api:"optional"`
	Content  string `json:"content" api:"optional"`
	Revision string `json:"revision" api:"optional"`
}

type TemplateFileEntry struct {
	Path      string `json:"path"`
	IsDir     bool   `json:"isDir"`
	IsPackage bool   `json:"isPackage,omitempty"`
}

type TemplateFileSource struct {
	Content  string  `json:"content"`
	Revision string  `json:"revision"`
	Path     *string `json:"path,omitempty"`
	// SourceDocID 是原始模板末尾文档级属性中的有效 ID；未声明时省略，不执行模板动作或检查来源可访问性。
	// 该 ID 仅用于尝试打开导出来源，不代表预览上下文；目录、普通 Markdown 和代码示例不提供来源。
	SourceDocID *string `json:"sourceDocID,omitempty"`
}

type TemplateFileRevision struct {
	Revision string `json:"revision"`
}

// TemplateManagementData 保留列表、读取、写入和空结果四种载荷。
type TemplateManagementData struct {
	entries  *[]TemplateFileEntry
	source   *TemplateFileSource
	revision *TemplateFileRevision
}

func TemplateEntries(entries []TemplateFileEntry) TemplateManagementData {
	return TemplateManagementData{entries: &entries}
}
func TemplateSource(source TemplateFileSource) TemplateManagementData {
	return TemplateManagementData{source: &source}
}
func TemplateRevision(revision TemplateFileRevision) TemplateManagementData {
	return TemplateManagementData{revision: &revision}
}

func (d TemplateManagementData) MarshalJSON() ([]byte, error) {
	if d.entries != nil {
		return json.Marshal(d.entries)
	}
	if d.source != nil {
		return json.Marshal(d.source)
	}
	if d.revision != nil {
		return json.Marshal(d.revision)
	}
	return []byte("null"), nil
}

func init() {
	ManageTemplateFiles.decodeFailure = func(err error) Response[TemplateManagementData] {
		return Failure[TemplateManagementData](-1, "Invalid template request")
	}
}
