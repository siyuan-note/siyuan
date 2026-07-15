//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// FILE_BASIC_INFO includes ChangeTime, the filesystem metadata-change clock.
// ByHandleFileInformation exposes only LastWriteTime; callers can restore that
// timestamp after an in-place write while retaining the same file ID, which
// would otherwise let a content-hash cache reuse stale bytes.
type fileBasicInfo struct {
	CreationTime   int64
	LastAccessTime int64
	LastWriteTime  int64
	ChangeTime     int64
	FileAttributes uint32
	_              uint32
}

func fileChangeToken(file *os.File, info os.FileInfo) (string, error) {
	var byHandle windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &byHandle); err != nil {
		return "", err
	}
	var basic fileBasicInfo
	if err := windows.GetFileInformationByHandleEx(
		windows.Handle(file.Fd()),
		windows.FileBasicInfo,
		(*byte)(unsafe.Pointer(&basic)),
		uint32(unsafe.Sizeof(basic)),
	); err != nil {
		return "", err
	}
	return fmt.Sprintf("v2:%d:%d:%d:%08x:%08x%08x", info.Size(), info.ModTime().UnixNano(), basic.ChangeTime, byHandle.VolumeSerialNumber, byHandle.FileIndexHigh, byHandle.FileIndexLow), nil
}
