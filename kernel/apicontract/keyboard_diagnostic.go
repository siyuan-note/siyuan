package apicontract

// SystemKeyboardLogRequest 接收 iOS 快捷键诊断，每批 1 至 50 条，整个请求最多 64 KiB。
// 仅管理员可写入，支持只读模式；记录不包含正文、组合输入文本、文档路径或设备标识。
// session 是页面随机会话编号，seq 是会话内递增编号，event 关联同一次按键的处理阶段。
// 文本字段限制长度，按键和目标只允许诊断用的固定分类；成功返回 null，非法记录返回 -1。
type SystemKeyboardLogRequest struct {
	Session string                   `json:"session"`
	Entries []SystemKeyboardLogEntry `json:"entries"`
}

type SystemKeyboardLogEntry struct {
	Seq          int                           `json:"seq"`
	Time         int64                         `json:"time"`
	Stage        string                        `json:"stage"`
	Event        int                           `json:"event" api:"optional"`
	Detail       string                        `json:"detail" api:"optional"`
	Command      string                        `json:"command" api:"optional"`
	ResponseCode *int                          `json:"responseCode,omitempty" api:"optional"`
	Keyboard     *SystemKeyboardLogEvent       `json:"keyboard,omitempty" api:"optional"`
	Environment  *SystemKeyboardLogEnvironment `json:"environment,omitempty" api:"optional"`
}

type SystemKeyboardLogEvent struct {
	Key               string `json:"key"`
	Code              string `json:"code"`
	KeyCode           int    `json:"keyCode"`
	Meta              bool   `json:"meta"`
	Ctrl              bool   `json:"ctrl"`
	Alt               bool   `json:"alt"`
	Shift             bool   `json:"shift"`
	Composing         bool   `json:"composing"`
	Repeat            bool   `json:"repeat"`
	Trusted           bool   `json:"trusted"`
	DefaultPrevented  bool   `json:"defaultPrevented"`
	CancelBubble      bool   `json:"cancelBubble"`
	Target            string `json:"target"`
	MatchSearch       bool   `json:"matchSearch"`
	MatchGlobalSearch bool   `json:"matchGlobalSearch"`
}

type SystemKeyboardLogEnvironment struct {
	Version      string   `json:"version"`
	UserAgent    string   `json:"userAgent"`
	Platform     string   `json:"platform"`
	Frontend     string   `json:"frontend"`
	Search       []string `json:"search"`
	GlobalSearch []string `json:"globalSearch"`
}
