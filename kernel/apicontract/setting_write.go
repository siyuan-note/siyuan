// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// SettingWriteMode 决定写配置端点的串行化与通知方式。
type SettingWriteMode int

const (
	// SettingNotify 在配置互斥锁内执行处理器，处理器未发布新的段修订时由包装层补发 settingChanged。
	// 适用于写入 conf.json 普通配置段、但自身不经过配置段提交通知的端点。
	SettingNotify SettingWriteMode = iota
	// SettingSilent 仅在配置互斥锁内执行，不补发通知。
	// 用于独立存储、仍然需要互斥的读取端点，以及写入由处理器自行发布通知的配置。
	SettingSilent
	// SettingSelfManaged 由处理器自行加锁和广播：命名空间取决于请求内容，或加锁前需要等待外部条件。
	SettingSelfManaged
)

// SettingWrite 声明端点写入的配置命名空间。零值表示端点不写入应用配置。
// 写入 conf.json、本地偏好或启动外观等配置文件的端点必须声明，契约测试按路径约定和处理器内容检查遗漏。
type SettingWrite struct {
	Namespace string // 变更通知中的配置命名空间，"*" 表示可能涉及多个配置段
	Mode      SettingWriteMode
	// Merge 声明请求体与配置段同构：解码前先合并进当前段，未提交的字段保持当前值，null 还原默认值。
	// 合并语义由 contractHandler 统一执行，与 /api/setting/patch 共用同一套输入迁移。
	Merge bool
}

// Declared 报告端点是否声明了配置写入。
func (setting SettingWrite) Declared() bool { return setting.Namespace != "" }
