package apicontract

// DocHistorySnapshotsRequest 批量查询同一文档当前页文件历史关联的本地标记快照。
// created 为 searchHistory 返回的时间戳，最多 32 项；op 默认为 all。
// 只关联认证解密后完整 .sy 数据相同的文件，不表示资源、数据库或引用内容相同。
// 没有仓库密钥时返回空关联；路径缺失、格式错误、认证失败及仓库损坏返回错误。
// 加密笔记本必须解锁，请求租约保持到响应结束；不下载云端快照，不保存内容摘要。
type DocHistorySnapshotsRequest struct {
	ID      string   `json:"id" api:"trim"`
	Created []string `json:"created"`
	Op      string   `json:"op" api:"optional"`
}

type DocHistorySnapshot struct {
	ID      string   `json:"id"`
	FileID  string   `json:"fileID"`
	Tags    []string `json:"tags"`
	Memo    string   `json:"memo"`
	Created int64    `json:"created"`
}

type DocHistorySnapshotEntry struct {
	Created     string                `json:"created"`
	HistoryPath string                `json:"historyPath"`
	Snapshots   []*DocHistorySnapshot `json:"snapshots"`
}

type DocHistorySnapshotsData struct {
	Histories []*DocHistorySnapshotEntry `json:"histories"`
}
