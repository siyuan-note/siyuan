// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// AIMemorySource 是可追溯来源；正文证据仅在管理员管理接口返回。
type AIMemorySource struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Revision string `json:"revision"`
	Evidence string `json:"evidence"`
}

type AIMemoryRecord struct {
	Confirmed  string `json:"confirmed"`
	ValidFrom  string `json:"validFrom"`
	ValidUntil string `json:"validUntil"`
	Reason     string `json:"reason"`
	Supersedes string `json:"supersedes"`

	ID       string           `json:"id"`
	Kind     string           `json:"kind"`
	Subject  string           `json:"subject"`
	Scope    string           `json:"scope"`
	State    string           `json:"state"`
	Content  string           `json:"content"`
	Sources  []AIMemorySource `json:"sources"`
	Created  string           `json:"created"`
	Updated  string           `json:"updated"`
	Revision string           `json:"revision"`
}
type AIMemoryListRequest struct {
	Query  string `json:"query" api:"optional"`
	Offset int    `json:"offset" api:"optional"`
	Limit  int    `json:"limit" api:"optional"`
}
type AIMemoryListData struct {
	Tasks      []AIMemoryTaskData `json:"tasks"`
	Records    []AIMemoryRecord   `json:"records"`
	Incomplete bool               `json:"incomplete"`
	Errors     []string           `json:"errors"`
}
type AIMemoryGetRequest struct {
	ID string `json:"id"`
}
type AIMemoryGetData struct {
	Record   AIMemoryRecord `json:"record"`
	Revision string         `json:"revision"`
}
type AIMemorySaveRequest struct {
	ID          string `json:"id" api:"optional"`
	Revision    string `json:"revision"`
	OperationID string `json:"operationId"`
	Content     string `json:"content"`
	Kind        string `json:"kind"`
	Subject     string `json:"subject"`
	Scope       string `json:"scope"`
	State       string `json:"state"`
}
type AIMemorySaveData struct {
	ID              string `json:"id"`
	Revision        string `json:"revision"`
	Saved           bool   `json:"saved"`
	OverviewPending bool   `json:"overviewPending"`
}
type AIMemoryForgetRequest struct {
	ID          string `json:"id"`
	Revision    string `json:"revision"`
	OperationID string `json:"operationId"`
}
type AIMemoryForgetData struct {
	// Saved 表示撤回标记已持久化且阻止使用；物理清理失败仍返回成功并设置 CleanupPending。
	Saved bool `json:"saved"`
	// CleanupPending 表示原记录尚未物理删除，可用相同请求重试；不代表撤回失效。
	CleanupPending bool `json:"cleanupPending"`
}
type AIMemoryOverviewData struct {
	// User 保留兼容字段；统一概览通过 Memory 返回。
	User   string `json:"user"`
	Memory string `json:"memory"`
	Stale  bool   `json:"stale"`
	// Count 仅包含来源有效且当前可用的正式记忆；不完整时不能作为精确总数展示。
	Count         int  `json:"count"`
	CountComplete bool `json:"countComplete"`
}
type AIMemoryTranslateRequest struct {
	// Memory 必须与当前有效概览逐字相同，不接受任意待翻译文本。
	Memory string `json:"memory"`
	// Language 必须是当前界面语言；仅为显示翻译，不回写记忆。
	Language string `json:"language"`
}
type AIMemoryTranslateData struct {
	Memory   string `json:"memory"`
	Language string `json:"language"`
}
type AIMemoryMaintainRequest struct {
	Text        string   `json:"text"`
	SourceIDs   []string `json:"sourceIDs" api:"optional"`
	OperationID string   `json:"operationId"`
}
type AIMemoryTaskRequest struct {
	TaskID string `json:"taskId"`
}
type AIMemoryTaskStarted struct {
	TaskID string `json:"taskId"`
}
type AIMemoryTaskResult struct {
	ID string `json:"id"`
	// Saved 表示该条新增或更新已持久化；候选记录仍需确认，不能据此推断已启用。
	Saved bool   `json:"saved"`
	Error string `json:"error"`
}
type AIMemoryTaskData struct {
	TaskID  string               `json:"taskId"`
	State   string               `json:"state"`
	Results []AIMemoryTaskResult `json:"results"`
	Error   string               `json:"error"`
	// OverviewPending 表示本任务已有已持久化结果且概览待刷新，不表示所有提案成功。
	OverviewPending bool `json:"overviewPending"`
}
type AIMemoryCapabilitiesData struct {
	Efforts []string `json:"efforts"`
}
