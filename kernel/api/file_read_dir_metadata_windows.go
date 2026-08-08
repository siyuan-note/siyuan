//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"errors"
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func captureReadDirMetadataReference(directory *os.File, name string) (reference *readDirMetadataReference, err error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, err
	}
	attributes := windows.OBJECT_ATTRIBUTES{
		RootDirectory: windows.Handle(directory.Fd()),
		ObjectName:    objectName,
		Attributes:    windows.OBJ_CASE_INSENSITIVE,
	}
	attributes.Length = uint32(unsafe.Sizeof(attributes))

	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(
		&handle,
		windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE,
		&attributes,
		&status,
		nil,
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.FILE_OPEN,
		windows.FILE_SYNCHRONOUS_IO_NONALERT|windows.FILE_OPEN_FOR_BACKUP_INTENT|windows.FILE_OPEN_REPARSE_POINT,
		0,
		0,
	)
	runtime.KeepAlive(directory)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), name)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return nil, errors.New("failed to create directory entry metadata handle")
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, file.Close())
		}
	}()

	info, err := file.Stat()
	if err == nil {
		err = pinWorkspaceFileInfo(info)
	}
	if err != nil {
		return nil, err
	}
	return &readDirMetadataReference{
		info:     info,
		sameFile: func(other os.FileInfo) bool { return os.SameFile(info, other) },
		close:    file.Close,
	}, nil
}
