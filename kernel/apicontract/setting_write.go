package apicontract

// SettingWriteMode 决定写配置端点的串行化与通知方式。
type SettingWriteMode int

const (
	// SettingNotify 在配置互斥锁内执行处理器，成功后向全部主界面广播 settingChanged 和命名空间。
	SettingNotify SettingWriteMode = iota
	// SettingSilent 仅在配置互斥锁内执行，用于独立存储的布局、本地偏好和启动外观选择。
	// conf.json 的普通配置段使用 SettingNotify，由提交漏斗发布变更。
	SettingSilent
	// SettingSelfManaged 由处理器自行加锁和广播：命名空间取决于请求内容，或加锁前需要等待外部条件。
	SettingSelfManaged
)

// SettingWrite 声明端点写入的配置命名空间。零值表示端点不写入应用配置。
// 写入 conf.json、本地偏好或启动外观等配置文件的端点必须声明，契约测试按路径约定和处理器内容检查遗漏。
type SettingWrite struct {
	Namespace string // 变更通知中的配置命名空间，"*" 表示可能涉及多个配置段
	Mode      SettingWriteMode
}

// Declared 报告端点是否声明了配置写入。
func (setting SettingWrite) Declared() bool { return setting.Namespace != "" }
