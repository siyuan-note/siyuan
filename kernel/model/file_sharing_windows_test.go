package model

import (
	"errors"
	"os"
	"runtime"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func requireReadSharingViolation(t *testing.T, path string, held syscall.Handle) {
	t.Helper()
	_, beforeStatErr := os.ReadFile(path)
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	_, afterStatErr := os.ReadFile(path)
	if errors.Is(beforeStatErr, windows.ERROR_SHARING_VIOLATION) && errors.Is(afterStatErr, windows.ERROR_SHARING_VIOLATION) {
		return
	}

	// 前置条件不成立时对比原生打开结果与文件身份，区分句柄、路径和读取实现问题。
	var heldInfo, probeInfo windows.ByHandleFileInformation
	heldInfoErr := windows.GetFileInformationByHandle(windows.Handle(held), &heldInfo)
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	probe, openErr := windows.CreateFile(ptr, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	var probeInfoErr error
	if openErr == nil {
		defer windows.CloseHandle(probe)
		probeInfoErr = windows.GetFileInformationByHandle(probe, &probeInfo)
	}
	t.Fatalf("read-denying fixture failed: path=%q, go=%s, read before Stat=%v, read after Stat=%v, native open=%v, held identity=%x:%x:%x (error=%v), probe identity=%x:%x:%x (error=%v)",
		path, runtime.Version(), beforeStatErr, afterStatErr, openErr,
		heldInfo.VolumeSerialNumber, heldInfo.FileIndexHigh, heldInfo.FileIndexLow, heldInfoErr,
		probeInfo.VolumeSerialNumber, probeInfo.FileIndexHigh, probeInfo.FileIndexLow, probeInfoErr)
}
