package apicontract

import "mime/multipart"

// NotebookArchiveCandidate 包含现存加密笔记本及只有本地历史或仓库快照的笔记本，不包含解密后的名称。
type NotebookArchiveCandidate struct {
	ID      string `json:"id"`
	Current bool   `json:"current"`
}

type NotebookArchiveCandidatesData struct {
	Notebooks []NotebookArchiveCandidate `json:"notebooks" api:"nonnullable"`
}

// PrepareNotebookArchiveRequest 必须显式选择至少一个笔记本；只接受已锁定的笔记本，不需要主密码。
// 归档保留原始密文、关联历史、本地仓库快照和现存密钥材料。成功仅生成归档，不移除任何源数据。
type PrepareNotebookArchiveRequest struct {
	Notebooks []string `json:"notebooks" api:"nonnullable"`
}

type NotebookArchiveData struct {
	ID   string `json:"id"`
	File string `json:"file"`
}

// CommitNotebookArchiveRequest 必须确认归档已另行保存；浏览器发起下载不等于保存成功。
// 内核复核源数据未变化后移出所选笔记本及关联历史；仓库快照不删除，原件留在工作区的独立恢复目录。
// 同一 ID 的成功提交可重复调用。部分移出保留全局密钥；全部依赖归档后仍需单独禁用再启用。
type CommitNotebookArchiveRequest struct {
	ID    string `json:"id"`
	Saved bool   `json:"saved"`
}

// ImportNotebookArchiveRequest 只接受尚无加密配置和加密数据、且未开启同步的独立工作区。
// Password 用于认证恢复材料和密文；Key 可提供后来找回的匹配密钥备份，不提供时使用归档内的材料。
// 导入保持原始标识与密文格式，完成后仍处于锁定状态；未知版本、认证失败或标识冲突不会覆盖已有数据。
type ImportNotebookArchiveRequest struct {
	File     *multipart.FileHeader `json:"file" api:"nonnullable"`
	Key      *multipart.FileHeader `json:"key" api:"optional,nonnullable"`
	Password string                `json:"password"`
}
