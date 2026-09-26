package apicontract

// MigrateLegacyMindmapsRequest 指定可编辑文档及其笔记本。迁移在文档事务中执行，并遵守加密笔记本访问校验。
type MigrateLegacyMindmapsRequest struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook"`
}

// MigrateLegacyMindmapsData 返回迁移操作数及当前文档中脑图根块的权威内容。
// 旧脑图代码块和带 custom-sy-list-mindmap="1" 的列表会升级为独立节点；无法完整转换的代码块保留原文。
// 转换保留原有块 ID 和元数据，执行前保存格式化历史，事务可撤销。
type MigrateLegacyMindmapsData struct {
	Converted int            `json:"converted"`
	Blocks    []BlockDOMData `json:"blocks"`
}
