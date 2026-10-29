// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// SettingGetSectionRequest 读取单个配置段。namespace 与 SetConf/SettingsPatch 的命名空间一致。
type SettingGetSectionRequest struct {
	Namespace string `json:"namespace" api:"trim"`
}

// SettingSectionData 返回单个配置段的脱敏内容，其余字段为 null。
// 可见字段与 /api/system/getConf 完全一致：非管理员不返回凭据，只读角色不返回界面布局，浏览器请求不返回工作空间路径。
type SettingSectionData struct {
	Namespace string `json:"namespace"`
	// Conf 仅填充请求的配置段；system 同时带回 api、oidc、accessAuthCode 和 readOnly。
	Conf *SystemAppConf `json:"conf"`
	// SettingTasks 为当前仍执行的设置维护任务，用于恢复任务阻塞。
	SettingTasks *SettingTaskState `json:"settingTasks,omitempty"`
	// Revision 是该段最近一次提交的版本号，同一命名空间严格递增；
	// 客户端据此丢弃版本号相等的重复通知，内核重启后版本号归零会重新触发读取。
	Revision uint64 `json:"revision"`
}
