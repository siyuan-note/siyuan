package apicontract

// ResetSettingsRequest 重置当前工作空间的普通偏好和内置布局。Exit 仅通知本地桌面前端在重载后正常退出，
// 不直接停止内核，默认为 false。保留笔记、历史、历史保留天数、账号、认证、同步、加密密钥、AI/MCP、
// 插件和代码片段及其启用状态、已保存布局、语言、网络配置，以及应用级设置。
// 所有已连接前端须先确认待保存内容已提交；超时或任一前端失败时不重置。重复调用恢复相同默认值。
type ResetSettingsRequest struct {
	Exit bool `json:"exit" api:"optional"`
}

// ConfirmSettingsResetRequest 仅确认 prepareSettingsReset 通知中的一次性令牌。
// Saved 为 false 时取消此次重置，不能用此接口单独修改配置。
type ConfirmSettingsResetRequest struct {
	Token string `json:"token"`
	Saved bool   `json:"saved"`
}
