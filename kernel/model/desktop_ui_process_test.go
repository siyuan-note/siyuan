// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"testing"

	goPS "github.com/mitchellh/go-ps"
)

type desktopUITestProcess string

func (p desktopUITestProcess) Pid() int           { return 123 }
func (p desktopUITestProcess) PPid() int          { return 1 }
func (p desktopUITestProcess) Executable() string { return string(p) }

func TestDesktopUILauncher(t *testing.T) {
	oldPID := desktopUILauncherPID
	desktopUILauncherPID = 123
	t.Cleanup(func() { desktopUILauncherPID = oldPID })
	for _, name := range []string{"SiYuan", "SiYuan.exe", "Electron", "electron.exe"} {
		if !desktopUILauncherAlive(func(pid int) (goPS.Process, error) {
			if pid != 123 {
				t.Fatalf("looked up unrelated process %d", pid)
			}
			return desktopUITestProcess(name), nil
		}) {
			t.Errorf("launcher %s should keep the kernel alive", name)
		}
	}
	for _, name := range []string{"SiYuan-Kernel", "SiYuan-Kernel.exe", "SiYuan Helper", "Electron Helper", "OtherElectronApp"} {
		if desktopUILauncherAlive(func(int) (goPS.Process, error) { return desktopUITestProcess(name), nil }) {
			t.Errorf("unrelated process %s kept the kernel alive", name)
		}
	}
	if desktopUILauncherAlive(func(int) (goPS.Process, error) { return nil, nil }) {
		t.Fatal("missing launcher kept the kernel alive")
	}
	if !desktopUILauncherAlive(func(int) (goPS.Process, error) { return nil, errors.New("access denied") }) {
		t.Fatal("process inspection failure should preserve the kernel")
	}
}
