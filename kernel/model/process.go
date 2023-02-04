// SiYuan - Build Your Eternal Digital Garden
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
	"strings"
	"syscall"
	"time"

	goPS "github.com/mitchellh/go-ps"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func HandleSignal() {
	c := make(chan os.Signal)
	signal.Notify(c, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGTERM)
	s := <-c
	logging.LogInfof("received os signal [%s], exit kernel process now", s)
	Close(false, 1)
}

var (
	firstRunHookDesktopUIProcJob = true
	noUIProcCount                int
)

func HookDesktopUIProcJob() {
	if util.ContainerStd != util.Container || "dev" == util.Mode {
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

	uiProcNames := []string{"siyuan", "electron"}
	uiProcessCount := 0
	util.UIProcessIDs.Range(func(uiProcIDArg, _ interface{}) bool {
		// 从 UI 进程 ID 列表中找到 UI 进程

		uiProcessCount++
		uiProcID, err := strconv.Atoi(uiProcIDArg.(string))
		if nil != err {
			logging.LogErrorf("invalid UI proc ID [%s]: %s", uiProcIDArg, err)
			return true
		}

		proc, err := goPS.FindProcess(uiProcID)
		if nil != err {
			logging.LogErrorf("find UI proc [%d] failed: %s", uiProcID, err)
			return true
		}

		if nil == proc {
			noUIProcCount++
			return true
		}

		procName := strings.ToLower(proc.Executable())
		uiProcOk := false
		for _, name := range uiProcNames {
			uiProcOk = strings.Contains(procName, name)
		}
		if !uiProcOk {
			noUIProcCount++
		}
		return true
	})

	if 1 > uiProcessCount {
		// 如果 UI 进程 ID 列表中没有找到 UI 进程则从完整的进程列表中找
		procs, _ := goPS.Processes()
		for _, proc := range procs {
			procName := strings.ToLower(proc.Executable())
			uiProcOk := false
			for _, name := range uiProcNames {
				uiProcOk = strings.Contains(procName, name)
			}
			if uiProcOk {
				uiProcessCount++
				break
			}
		}

		if 1 > uiProcessCount {
			noUIProcCount++
		}
	}

	if 0 < noUIProcCount {
		logging.LogInfof("no active UI proc count [%d]", noUIProcCount)
		if 1 < noUIProcCount {
			logging.LogInfof("confirmed no active UI proc, exit kernel process now")
			Close(false, 1)
		}
	}
}
