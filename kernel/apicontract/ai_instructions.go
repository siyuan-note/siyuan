// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// AIAgentInstructionsData 是工作空间 data/storage/ai/AGENTS.md 的 UTF-8 原文与内容修订标识。
// 兼容读取旧路径 data/ai/AGENTS.md；读取不迁移，两处内容不同时返回 code -1 并保留两份文件。
// 文件缺失返回空正文和 missing 修订，不创建文件；读取失败、非文本或超过 32 KiB 返回 code -1。
// 指令在下一次用户发起对话时生效，同一轮工具调用及上下文压缩使用相同快照。
type AIAgentInstructionsData struct {
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

// AIAgentInstructionsSaveRequest 必须携带读取时的修订标识；冲突返回 code -1 并保留原文。
// 允许空正文，最多 32 KiB UTF-8 文本。固定路径原子保存，成功后通知同步；用户同步忽略规则仍有效。
// 保存时先持久化旧原文到新路径，再移除旧文件；旧路径的同步忽略规则应在保存前更新为新路径。
// 接口要求管理员且禁止只读写入，不为智能体注册修改长期指令的专用工具。
type AIAgentInstructionsSaveRequest struct {
	Content  string `json:"content"`
	Revision string `json:"revision"`
}
