package apicontract

// AIAgentInstructionsData 是工作空间 data/ai/AGENTS.md 的 UTF-8 原文与内容修订标识。
// 文件缺失返回空正文和 missing 修订，不创建文件；读取失败、非文本或超过 32 KiB 返回 code -1。
// 指令在下一次用户发起对话时生效，同一轮工具调用及上下文压缩使用相同快照。
type AIAgentInstructionsData struct {
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

// AIAgentInstructionsSaveRequest 必须携带读取时的修订标识；冲突返回 code -1 并保留原文。
// 允许空正文，最多 32 KiB UTF-8 文本。固定路径原子保存，成功后通知同步；用户同步忽略规则仍有效。
// 接口要求管理员且禁止只读写入，不为智能体注册修改长期指令的专用工具。
type AIAgentInstructionsSaveRequest struct {
	Content  string `json:"content"`
	Revision string `json:"revision"`
}
