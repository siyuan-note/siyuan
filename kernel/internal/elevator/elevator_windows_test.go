// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package elevator

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestShellExecuteInfoLayout(t *testing.T) {
	var info shellExecuteInfo
	size, processOffset := uintptr(60), uintptr(56)
	if unsafe.Sizeof(uintptr(0)) == 8 {
		size, processOffset = 112, 104
	}
	if unsafe.Sizeof(info) != size || unsafe.Offsetof(info.process) != processOffset {
		t.Fatalf("unexpected native structure layout: size %d, process offset %d", unsafe.Sizeof(info), unsafe.Offsetof(info.process))
	}
}

func TestElevatedProcessResult(t *testing.T) {
	// 使用不提权的测试进程验证原生接口、Unicode 路径和最终退出码，不修改系统配置。
	source, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "思源 helper.exe")
	if err = os.WriteFile(executable, data, 0700); err != nil {
		t.Fatal(err)
	}
	for _, exitCode := range []int{0, 7, 259} {
		t.Run(strconv.Itoa(exitCode), func(t *testing.T) {
			workingDir := filepath.Join(t.TempDir(), "工作 空间")
			if err := os.Mkdir(workingDir, 0700); err != nil {
				t.Fatal(err)
			}
			receipt := filepath.Join(t.TempDir(), "arguments.json")
			expected := []string{"add-defender-exclusion", `D:\Program Files\SiYuan`, `D:\工作 空间\`, `D:\O'Brien\$notes`}
			args := append([]string{"-test.run=^TestElevatedProcessHelper$", "--", receipt, strconv.Itoa(exitCode)}, expected...)
			for i := range args {
				args[i] = syscall.EscapeArg(args[i])
			}
			arguments := strings.Join(args, " ")
			var process windows.Handle
			err := run(executable, workingDir, arguments, func(info *shellExecuteInfo) error {
				if windows.UTF16PtrToString(info.verb) != "runas" || info.mask != seeMaskNoCloseProcess|seeMaskNoAsync|seeMaskFlagNoUI || info.show != windows.SW_HIDE {
					t.Fatal("missing native elevation flags")
				}
				if windows.UTF16PtrToString(info.file) != executable || windows.UTF16PtrToString(info.directory) != workingDir || windows.UTF16PtrToString(info.parameters) != arguments {
					t.Fatal("native process parameters changed")
				}
				info.verb, _ = windows.UTF16PtrFromString("open")
				if err := launch(info); err != nil {
					return err
				}
				process = info.process
				return nil
			})
			if exitCode == 0 && err != nil || exitCode != 0 && (err == nil || !strings.Contains(err.Error(), "exit code "+strconv.Itoa(exitCode))) {
				t.Fatalf("unexpected process result: %v", err)
			}
			assertHandleClosed(t, process)
			data, err := os.ReadFile(receipt)
			if err != nil {
				t.Fatal(err)
			}
			var actual struct {
				Arguments  []string
				WorkingDir string
			}
			if err := json.Unmarshal(data, &actual); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual.Arguments, expected) || !strings.EqualFold(actual.WorkingDir, workingDir) {
				t.Fatalf("process arguments or working directory changed: %+v", actual)
			}
		})
	}
}

func TestElevatedProcessHelper(t *testing.T) {
	for i, arg := range os.Args {
		if arg != "--" {
			continue
		}
		if len(os.Args) < i+4 {
			t.Fatal("missing helper arguments")
		}
		workingDir, err := os.Getwd()
		if err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(struct {
			Arguments  []string
			WorkingDir string
		}{os.Args[i+3:], workingDir})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(os.Args[i+1], data, 0600); err != nil {
			t.Fatal(err)
		}
		exitCode, err := strconv.Atoi(os.Args[i+2])
		if err != nil {
			t.Fatal(err)
		}
		os.Exit(exitCode)
	}
}

func TestElevatedProcessLaunchFailure(t *testing.T) {
	err := Run(filepath.Join(t.TempDir(), "missing.exe"), t.TempDir(), "add-defender-exclusion install workspace")
	if !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		t.Fatalf("expected missing executable error, got %v", err)
	}
	for _, failure := range []error{windows.ERROR_CANCELLED, windows.ERROR_ACCESS_DENIED} {
		err := run("helper.exe", "working", "arguments", func(*shellExecuteInfo) error { return failure })
		if !errors.Is(err, failure) {
			t.Fatalf("launch error was lost: %v", err)
		}
	}
}

func TestElevatedProcessInvalidInput(t *testing.T) {
	for _, args := range [][3]string{{"helper\x00.exe", "working", "arguments"}, {"helper.exe", "working\x00", "arguments"}, {"helper.exe", "working", "arguments\x00"}} {
		err := run(args[0], args[1], args[2], func(*shellExecuteInfo) error {
			t.Fatal("invalid input reached the elevation boundary")
			return nil
		})
		if err == nil {
			t.Fatal("invalid UTF-16 input was accepted")
		}
	}
}

func TestElevatedProcessHandleFailures(t *testing.T) {
	t.Run("missing", func(t *testing.T) {
		err := run("helper.exe", "working", "arguments", func(*shellExecuteInfo) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "handle unavailable") {
			t.Fatalf("missing process handle was accepted: %v", err)
		}
	})
	t.Run("wait", func(t *testing.T) {
		process, err := windows.CreateEvent(nil, 1, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = windows.CloseHandle(process); err != nil {
			t.Fatal(err)
		}
		err = run("helper.exe", "working", "arguments", func(info *shellExecuteInfo) error {
			info.process = process
			return nil
		})
		if !errors.Is(err, windows.ERROR_INVALID_HANDLE) || !strings.Contains(err.Error(), "wait for") {
			t.Fatalf("wait failure was accepted: %v", err)
		}
	})
	t.Run("exitCode", func(t *testing.T) {
		// 使用已触发事件完成真实等待，在查询边界模拟权限错误并检查句柄释放。
		process, err := windows.CreateEvent(nil, 1, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		err = waitForProcess(process, windows.WaitForSingleObject, func(windows.Handle, *uint32) error {
			return windows.ERROR_ACCESS_DENIED
		})
		if !errors.Is(err, windows.ERROR_ACCESS_DENIED) || !strings.Contains(err.Error(), "get elevated helper exit code") {
			t.Fatalf("exit code query failure was accepted: %v", err)
		}
		assertHandleClosed(t, process)
	})
	t.Run("unexpectedWait", func(t *testing.T) {
		process, err := windows.CreateEvent(nil, 1, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		err = waitForProcess(process, func(windows.Handle, uint32) (uint32, error) {
			return uint32(windows.WAIT_TIMEOUT), nil
		}, func(windows.Handle, *uint32) error {
			t.Fatal("exit code queried before process termination")
			return nil
		})
		if err == nil || !strings.Contains(err.Error(), "unexpected elevated helper wait result") {
			t.Fatalf("unexpected wait result was accepted: %v", err)
		}
		assertHandleClosed(t, process)
	})
}

func TestNativeLaunchPreservesCOM(t *testing.T) {
	for _, mode := range []uint32{coInitApartment, 0} {
		t.Run(strconv.FormatUint(uint64(mode), 10), func(t *testing.T) {
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()
			if err := windows.CoInitializeEx(0, mode); err != nil && !errors.Is(err, syscall.Errno(windows.S_FALSE)) {
				t.Fatal(err)
			}
			defer windows.CoUninitialize()
			if err := Run(filepath.Join(t.TempDir(), "missing.exe"), t.TempDir(), "arguments"); !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
				t.Fatalf("native launch failed in existing COM apartment: %v", err)
			}
			err := windows.CoInitializeEx(0, mode)
			if err == nil || errors.Is(err, syscall.Errno(windows.S_FALSE)) {
				defer windows.CoUninitialize()
			}
			if !errors.Is(err, syscall.Errno(windows.S_FALSE)) {
				t.Fatalf("caller's COM reference was released: %v", err)
			}
		})
	}
}

func assertHandleClosed(t *testing.T, process windows.Handle) {
	t.Helper()
	if _, err := windows.WaitForSingleObject(process, 0); !errors.Is(err, windows.ERROR_INVALID_HANDLE) {
		t.Fatalf("process handle was not closed: %v", err)
	}
}
