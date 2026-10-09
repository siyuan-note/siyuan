package apicontract

// DailyNoteInfoRequest 查询指定笔记本的日记候选，不创建文档或修改已有日记属性。
// Date 为本地公历日期 YYYY-MM-DD，省略、空串或 null 时使用当天；日期无效返回 -1。
// 已有文档按日期属性及模板路径定位，返回实际标题和不含笔记本名的绝对人类路径。
// 不存在时返回解析后的创建标题和路径，ID 为空；不存在的笔记本返回 1。
// 需要管理员权限，允许只读模式，加密笔记本必须解锁并保留响应租约。
type DailyNoteInfoRequest struct {
	Notebook string `json:"notebook"`
	Date     string `json:"date" api:"optional,nullable"`
}

type DailyNoteInfo struct {
	ID      string `json:"id"`
	HPath   string `json:"hPath"`
	Title   string `json:"title"`
	Existed bool   `json:"existed"`
}
