// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"strings"

	goPS "github.com/mitchellh/go-ps"
)

// 启动时保留父进程 ID，避免父进程退出后内核被系统进程接管而改变判断依据。
var desktopUILauncherPID = os.Getppid()

func isDesktopUIProcess(name string) bool {
	switch strings.ToLower(name) {
	case "siyuan", "siyuan.exe", "electron", "electron.exe":
		return true
	}
	return false
}

// desktopUILauncherAlive 仅将启动此内核的桌面主进程作为未注册 UI 的兜底。
// 其他工作空间的内核、渲染进程及其他 Electron 应用不能维持本工作空间的存活。
func desktopUILauncherAlive(find func(int) (goPS.Process, error)) bool {
	if desktopUILauncherPID <= 1 {
		return false
	}
	proc, err := find(desktopUILauncherPID)
	if err != nil {
		return true
	}
	return proc != nil && isDesktopUIProcess(proc.Executable())
}
