package model

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 新建空工作空间启用菜单鼠标滚动；已有工作空间缺省保持关闭，不读取旧 KV 偏好。
func initMenuMouseScrollPreference(appearance *conf.Appearance, confFileExists bool, notebookCount int) {
	if !confFileExists && notebookCount == 0 && !util.ReadOnly {
		appearance.MenuMouseScroll = true
	}
}
