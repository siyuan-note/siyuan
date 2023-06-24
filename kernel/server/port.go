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

package server

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	goPS "github.com/mitchellh/go-ps"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func killRunningKernel() {
	defer logging.Recover()

	now := time.Now()
	defer logging.LogInfof("check running kernel elapsed [%dms]", time.Since(now).Milliseconds())

	processes, err := goPS.Processes()
	if nil != err {
		logging.LogErrorf("get processes failed: %s", err)
		killByPort(util.FixedPort)
		return
	}

	currentPid := os.Getpid()
	killed := false
	for _, process := range processes {
		if process.Pid() == currentPid {
			continue
		}
		procName := strings.ToLower(process.Executable())
		if strings.Contains(procName, "siyuan-kernel") {
			kill(fmt.Sprintf("%d", process.Pid()))
			killed = true
		}
	}

	if killed {
		portJSON := filepath.Join(util.HomeDir, ".config", "siyuan", "port.json")
		os.RemoveAll(portJSON)
	}
}

func killByPort(port string) {
	if !isPortOpen(port) {
		return
	}

	portJSON := filepath.Join(util.HomeDir, ".config", "siyuan", "port.json")
	os.RemoveAll(portJSON)

	pid := pidByPort(port)
	if "" == pid {
		return
	}

	pidInt, _ := strconv.Atoi(pid)
	proc, _ := goPS.FindProcess(pidInt)
	var name string
	if nil != proc {
		name = proc.Executable()
	}
	kill(pid)
	logging.LogInfof("killed process [name=%s, pid=%s]", name, pid)
}

func isPortOpen(port string) bool {
	timeout := time.Second
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), timeout)
	if nil != err {
		return false
	}
	if nil != conn {
		conn.Close()
		return true
	}
	return false
}

func kill(pid string) {
	var killCmd *exec.Cmd
	if gulu.OS.IsWindows() {
		killCmd = exec.Command("cmd", "/c", "TASKKILL /F /PID "+pid)
	} else {
		killCmd = exec.Command("kill", "-9", pid)
	}
	gulu.CmdAttr(killCmd)
	killCmd.CombinedOutput()
}

func pidByPort(port string) (ret string) {
	if gulu.OS.IsWindows() {
		cmd := exec.Command("cmd", "/c", "netstat -ano | findstr "+port)
		gulu.CmdAttr(cmd)
		data, err := cmd.CombinedOutput()
		if nil != err {
			logging.LogErrorf("netstat failed: %s", err)
			return
		}
		output := string(data)
		lines := strings.Split(output, "\n")
		for _, l := range lines {
			if strings.Contains(l, "LISTENING") {
				l = l[strings.Index(l, "LISTENING")+len("LISTENING"):]
				l = strings.TrimSpace(l)
				ret = l
				return
			}
		}
		return
	}

	cmd := exec.Command("lsof", "-Fp", "-i", ":"+port)
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		logging.LogErrorf("lsof failed: %s", err)
		return
	}
	output := string(data)
	lines := strings.Split(output, "\n")
	for _, l := range lines {
		if strings.HasPrefix(l, "p") {
			l = l[1:]
			ret = l
			return
		}
	}
	return
}
