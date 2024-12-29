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
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sys/windows"
)

func AddMicrosoftDefenderExclusion() (err error) {
	if !gulu.OS.IsWindows() {
		return
	}

	if !isUsingMicrosoftDefender() {
		return
	}

	installPath := filepath.Dir(util.WorkingDir)
	psArgs := []string{"-Command", "Add-MpPreference", "-ExclusionPath", installPath, ",", util.WorkspaceDir}
	if isAdmin() {
		cmd := exec.Command("powershell", psArgs...)
		gulu.CmdAttr(cmd)
		output, cmdErr := cmd.CombinedOutput()
		if nil != cmdErr {
			logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s, %s", installPath, cmdErr, string(output))
			err = cmdErr
			return
		}
	} else {
		elevator := filepath.Join(util.WorkingDir, "elevator.exe")
		if "dev" == util.Mode || !gulu.File.IsExist(elevator) {
			elevator = filepath.Join(util.WorkingDir, "elevator", "elevator-"+runtime.GOARCH+".exe")
		}

		if !gulu.File.IsExist(elevator) {
			msg := fmt.Sprintf("not found elevator [%s]", elevator)
			logging.LogWarnf(msg)
			err = errors.New(msg)
			return
		}

		ps := []string{"powershell"}
		ps = append(ps, psArgs...)
		verbPtr, _ := syscall.UTF16PtrFromString("runas")
		exePtr, _ := syscall.UTF16PtrFromString(elevator)
		cwdPtr, _ := syscall.UTF16PtrFromString(util.WorkingDir)
		argPtr, _ := syscall.UTF16PtrFromString(strings.Join(ps, " "))
		execErr := windows.ShellExecute(0, verbPtr, exePtr, argPtr, cwdPtr, 1)
		if execErr != nil {
			logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s", installPath, execErr)
			err = execErr
			return
		}
	}
	return
}

func AutoProcessMicrosoftDefender() {
	processMicrosoftDefender()
}

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
	psArgs := []string{"-Command", "Add-MpPreference", "-ExclusionPath", installPath, ",", util.WorkspaceDir}
	if isAdmin() {
		cmd := exec.Command("powershell", psArgs...)
		gulu.CmdAttr(cmd)
		output, err := cmd.CombinedOutput()
		if nil != err {
			logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s, %s", installPath, err, string(output))
			return
		}
	} else {
		ps := []string{"powershell"}
		ps = append(ps, psArgs...)
		verbPtr, _ := syscall.UTF16PtrFromString("runas")
		exePtr, _ := syscall.UTF16PtrFromString(elevator)
		cwdPtr, _ := syscall.UTF16PtrFromString(util.WorkingDir)
		argPtr, _ := syscall.UTF16PtrFromString(strings.Join(ps, " "))
		err := windows.ShellExecute(0, verbPtr, exePtr, argPtr, cwdPtr, 1)
		if err != nil {
			logging.LogErrorf("add Windows Defender exclusion path [%s] failed: %s", installPath, err)
			return
		}
	}

	// TODO Conf.System.MicrosoftDefenderExcluded = true
	//Conf.Save()
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
