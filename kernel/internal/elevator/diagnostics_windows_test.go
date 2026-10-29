// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package elevator

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestDiagnosticReceiver(t *testing.T) {
	receiver, err := newDiagnosticReceiver()
	if err != nil {
		t.Fatal(err)
	}
	defer receiver.listener.Close()
	for _, message := range []struct{ Token, Error string }{{"wrong token", "forged result"}, {receiver.token, "Defender 拒绝添加排除项"}} {
		connection, err := net.Dial("tcp4", receiver.listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		if err := json.NewEncoder(connection).Encode(message); err != nil {
			t.Fatal(err)
		}
		_ = connection.Close()
	}
	if got := receiver.read(); got != "Defender 拒绝添加排除项" {
		t.Fatalf("diagnostic message changed: %s", got)
	}
}

func TestReportedProcessResult(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, exitCode := range []int{0, 1} {
		t.Run(strconv.Itoa(exitCode), func(t *testing.T) {
			arguments := "-test.run=^TestDiagnosticProcessHelper$ -- " + strconv.Itoa(exitCode)
			err := runWithDiagnostics(executable, t.TempDir(), arguments, func(info *shellExecuteInfo) error {
				info.verb, _ = windows.UTF16PtrFromString("open")
				return launch(info)
			})
			if exitCode == 0 {
				if err != nil {
					t.Fatalf("successful process rejected: %v", err)
				}
				return
			}
			var processError *ProcessError
			if !errors.As(err, &processError) || !strings.Contains(err.Error(), "exit code 1") || processError.Diagnostics != "verification failed: Defender 本地化错误" {
				t.Fatalf("process diagnostics missing: %v", err)
			}
			if strings.Contains(err.Error(), "本地化错误") {
				t.Fatal("diagnostics changed the concise process error")
			}
		})
	}
	if err := runWithDiagnostics(filepath.Join(t.TempDir(), "missing.exe"), t.TempDir(), "arguments", launch); !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		t.Fatalf("launch error changed: %v", err)
	}
}

func TestDiagnosticProcessHelper(t *testing.T) {
	for index, argument := range os.Args {
		if argument != "--report" {
			continue
		}
		exitCode, err := strconv.Atoi(os.Args[index-1])
		if err != nil {
			os.Exit(2)
		}
		connection, err := net.DialTimeout("tcp4", os.Args[index+1], 2*time.Second)
		if err != nil {
			os.Exit(2)
		}
		message := ""
		if exitCode != 0 {
			message = "verification failed: Defender 本地化错误"
		}
		_ = json.NewEncoder(connection).Encode(diagnosticReport{Token: os.Args[index+2], Error: message})
		_ = connection.Close()
		os.Exit(exitCode)
	}
}

func TestMissingDiagnosticsPreserveFailure(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// 不支持回传的辅助进程仍按最终退出码判定失败，并明确记录诊断缺失。
	err = runWithDiagnostics(executable, t.TempDir(), "-test.run=^TestUnreportedProcessHelper$ --", func(info *shellExecuteInfo) error {
		info.verb, _ = windows.UTF16PtrFromString("open")
		return launch(info)
	})
	var processError *ProcessError
	if !errors.As(err, &processError) || !strings.Contains(err.Error(), "exit code 1") || !strings.Contains(processError.Diagnostics, "no authenticated report") {
		t.Fatalf("missing report changed process failure: %v", err)
	}
}

func TestUnreportedProcessHelper(t *testing.T) {
	for _, argument := range os.Args {
		if argument == "--report" {
			os.Exit(1)
		}
	}
}

func TestDiagnosticInvalidInput(t *testing.T) {
	for _, args := range [][3]string{{"helper\x00.exe", "working", "arguments"}, {"helper.exe", "working\x00", "arguments"}, {"helper.exe", "working", "arguments\x00"}} {
		if err := runWithDiagnostics(args[0], args[1], args[2], func(*shellExecuteInfo) error { t.Fatal("invalid input reached launch"); return nil }); err == nil {
			t.Fatal("invalid input accepted")
		}
	}
	failure := syscall.Errno(windows.ERROR_CANCELLED)
	if err := runWithDiagnostics("helper.exe", "working", "arguments", func(*shellExecuteInfo) error { return failure }); !errors.Is(err, failure) {
		t.Fatalf("cancellation error changed: %v", err)
	}
}
