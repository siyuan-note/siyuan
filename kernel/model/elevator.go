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

//go:build windows

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func processMicrosoftDefender() {
	if !gulu.OS.IsWindows() || Conf.System.MicrosoftDefenderExcluded {
		return
	}

	elevator := filepath.Join(util.WorkingDir, "elevator.exe")
	if "dev" == util.Mode || !gulu.File.IsExist(elevator) {
		elevator = filepath.Join(util.WorkingDir, "elevator", "elevator-"+runtime.GOARCH+".exe")
	}

	if !gulu.File.IsExist(elevator) {
		logging.LogWarnf("not found elevator [%s]", elevator)
		return
	}

	if !isUsingMicrosoftDefender() {
		return
	}

	installPath := filepath.Dir(util.WorkingDir)

	if isAdmin() {
		cmd := exec.Command("powershell", "-Command", "Add-MpPreference", "-ExclusionPath", installPath, ",", util.WorkspaceDir)
		gulu.CmdAttr(cmd)
		output, err := cmd.CombinedOutput()
		if nil != err {
			logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s, %s", installPath, err, string(output))
			return
		}
		return
	}

	cwd, _ := os.Getwd()
	args := strings.Join([]string{"powershell", "-Command", "Add-MpPreference", "-ExclusionPath", installPath, ",", util.WorkspaceDir}, " ")
	verbPtr, _ := syscall.UTF16PtrFromString("runas")
	exePtr, _ := syscall.UTF16PtrFromString(elevator)
	cwdPtr, _ := syscall.UTF16PtrFromString(cwd)
	argPtr, _ := syscall.UTF16PtrFromString(args)
	err := windows.ShellExecute(0, verbPtr, exePtr, argPtr, cwdPtr, 1)
	if err != nil {
		logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s", installPath, err)
		return
	}

	// TODO Conf.System.MicrosoftDefenderExcluded = true
	Conf.Save()
}

func isUsingMicrosoftDefender() bool {
	if !gulu.OS.IsWindows() {
		return false
	}

	cmd := exec.Command("powershell", "-Command", "Get-MpPreference")
	gulu.CmdAttr(cmd)
	return cmd.Run() == nil
}

func isAdmin() bool {
	_, err := os.Open("\\\\.\\PHYSICALDRIVE0")
	return err == nil
}
