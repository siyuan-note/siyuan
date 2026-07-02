// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

// StatusBar 底部状态栏配置。https://github.com/siyuan-note/siyuan/issues/16236
type StatusBar struct {
	MsgTaskDatabaseIndexCommitDisabled        bool `json:"msgTaskDatabaseIndexCommitDisabled"`
	MsgTaskHistoryDatabaseIndexCommitDisabled bool `json:"msgTaskHistoryDatabaseIndexCommitDisabled"`
	MsgTaskAssetDatabaseIndexCommitDisabled   bool `json:"msgTaskAssetDatabaseIndexCommitDisabled"`
	MsgTaskHistoryGenerateFileDisabled        bool `json:"msgTaskHistoryGenerateFileDisabled"`
}

var StatusBarCfg *StatusBar

// Notifications 外观通知开关配置。https://github.com/siyuan-note/siyuan/issues/17797
// Appearance.Notifications 为 nil 时表示旧配置尚未迁移，整体按默认启用处理。
type Notifications struct {
	DocTreeMaxList       bool `json:"docTreeMaxList"`       // 文档面板展开上限提示，默认启用
	TagMaxList           bool `json:"tagMaxList"`           // 标签面板展开上限提示，默认启用
	WorkspaceNotSSD      bool `json:"workspaceNotSSD"`      // 工作空间未放置在固态硬盘警告，默认启用
	BrowserCompatibility bool `json:"browserCompatibility"` // 浏览器兼容性提示，默认启用
}

// NewNotifications 创建默认全部启用的通知配置。新增内置通知时在此统一调整默认值，避免多处分散。
func NewNotifications() *Notifications {
	return &Notifications{
		DocTreeMaxList:       true,
		TagMaxList:           true,
		WorkspaceNotSSD:      true,
		BrowserCompatibility: true,
	}
}

var NotificationsCfg *Notifications
