// SiYuan - From thought to insight, with agents
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
const StatusBarVersion = 1

type StatusBar struct {
	Version                                   int  `json:"version"`
	MsgTaskDatabaseIndexCommitDisabled        bool `json:"msgTaskDatabaseIndexCommitDisabled"`
	MsgTaskHistoryDatabaseIndexCommitDisabled bool `json:"msgTaskHistoryDatabaseIndexCommitDisabled"`
	MsgTaskAssetDatabaseIndexCommitDisabled   bool `json:"msgTaskAssetDatabaseIndexCommitDisabled"`
	MsgTaskHistoryGenerateFileDisabled        bool `json:"msgTaskHistoryGenerateFileDisabled"`
	MsgDataSyncDisabled                       bool `json:"msgDataSyncDisabled"`
}

// NewStatusBar 创建适合当前容器的状态栏消息默认配置。
func NewStatusBar(mobile bool) *StatusBar {
	statusBar := &StatusBar{Version: StatusBarVersion}
	if mobile {
		statusBar.MsgTaskDatabaseIndexCommitDisabled = true
		statusBar.MsgTaskHistoryDatabaseIndexCommitDisabled = true
		statusBar.MsgTaskAssetDatabaseIndexCommitDisabled = true
	}
	return statusBar
}

// NormalizeStatusBar 一次性迁移状态栏消息配置，迁移完成后保留用户的手动设置。
func NormalizeStatusBar(statusBar *StatusBar, mobile bool) *StatusBar {
	if nil == statusBar {
		return NewStatusBar(mobile)
	}
	if statusBar.Version >= StatusBarVersion {
		return statusBar
	}
	if mobile {
		statusBar.MsgTaskDatabaseIndexCommitDisabled = true
		statusBar.MsgTaskHistoryDatabaseIndexCommitDisabled = true
		statusBar.MsgTaskAssetDatabaseIndexCommitDisabled = true
	}
	statusBar.Version = StatusBarVersion
	return statusBar
}

var StatusBarCfg *StatusBar

// Notifications 外观通知开关配置。https://github.com/siyuan-note/siyuan/issues/17797
// Appearance.Notifications 为 nil 时表示旧配置尚未迁移，整体按默认启用处理。
type Notifications struct {
	DocTreeMaxList       bool  `json:"docTreeMaxList"`             // 文档面板展开上限提示，默认启用
	TagMaxList           bool  `json:"tagMaxList"`                 // 标签面板展开上限提示，默认启用
	WorkspaceNotSSD      bool  `json:"workspaceNotSSD"`            // 工作空间未放置在固态硬盘警告，默认启用
	BrowserCompatibility bool  `json:"browserCompatibility"`       // 浏览器兼容性提示，默认启用
	SelectAllTip         *bool `json:"selectAllTip,omitempty"`     // 编辑器全选提示，nil 时默认启用
	FormatPainterTip     *bool `json:"formatPainterTip,omitempty"` // 格式刷启用和退出提示，nil 时默认启用
}

// NewNotifications 创建默认全部启用的通知配置。新增内置通知时在此统一调整默认值，避免多处分散。
func NewNotifications() *Notifications {
	return &Notifications{
		DocTreeMaxList:       true,
		TagMaxList:           true,
		WorkspaceNotSSD:      true,
		BrowserCompatibility: true,
		SelectAllTip:         new(true),
		FormatPainterTip:     new(true),
	}
}

var NotificationsCfg *Notifications
