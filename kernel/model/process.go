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

package model

import (
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	goPS "github.com/mitchellh/go-ps"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func HandleSignal() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGTERM)
	s := <-c
	logging.LogInfof("received os signal [%s], exit kernel process now", s)
	if code, _ := Close(false, true, 1); code == 0 {
		ExitKernel()
	}
}

var (
	firstRunHookDesktopUIProcJob = true
)

func HookDesktopUIProcJob() {
	if !util.AttachUI || util.ContainerStd != util.Container || "dev" == util.Mode {
		return
	}

	if firstRunHookDesktopUIProcJob {
		// 等待启动结束再监控
		time.Sleep(30 * time.Second)
		firstRunHookDesktopUIProcJob = false
		return
	}

	if 0 < util.CountSessions() {
		// 如果存在活动的会话则说明 UI 进程还在运行
		return
	}

	uiProcCount := getAttachedUIProcCount()
	if 0 < uiProcCount {
		return
	}

	logging.LogWarnf("no active UI proc, continue to check from attached ui processes after 15s")
	time.Sleep(15 * time.Second)
	uiProcCount = getAttachedUIProcCount()
	if 0 < uiProcCount {
		return
	}
	logging.LogWarnf("no active UI proc, continue to check attached UI and launcher after 15s")
	time.Sleep(15 * time.Second)
	// 宽限期间可能建立新会话，退出前重新检查工作空间的连接和注册进程。
	if 0 < util.CountSessions() || 0 < getAttachedUIProcCount() || desktopUILauncherAlive(goPS.FindProcess) {
		return
	}

	logging.LogWarnf("confirmed no active UI proc, exit kernel process now")
	if code, _ := Close(false, true, 1); code == 0 {
		ExitKernel()
	}
}

// getAttachedUIProcCount 获取已经附加的 UI 进程数。
func getAttachedUIProcCount() (ret int) {
	util.UIProcessIDs.Range(func(uiProcIDArg, _ any) bool {
		uiProcID, err := strconv.Atoi(uiProcIDArg.(string))
		if err != nil {
			// 清理无效的 UI 进程 ID，防止注册表被污染
			util.UIProcessIDs.Delete(uiProcIDArg)
			logging.LogErrorf("invalid UI proc ID [%s]: %s", uiProcIDArg, err)
			return true
		}

		proc, err := goPS.FindProcess(uiProcID)
		if err != nil {
			logging.LogErrorf("find UI proc [%d] failed: %s", uiProcID, err)
			// 查询失败不能证明界面已经关闭，保留内核供后续检查。
			ret++
			return true
		}

		if nil == proc {
			// 清理已经不存在的 UI 进程 ID
			util.UIProcessIDs.Delete(uiProcIDArg)
			return true
		}

		if isDesktopUIProcess(proc.Executable()) {
			ret++
		}
		return true
	})
	return
}
