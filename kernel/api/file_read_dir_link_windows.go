// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

type workspaceFileAttributeTagInfo struct {
	fileAttributes uint32
	reparseTag     uint32
}

func classifyWorkspaceLink(path string, _ os.FileInfo) (workspaceLinkKind, error) {
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return workspaceNotLink, err
	}
	attributes, err := windows.GetFileAttributes(pathPtr)
	if err != nil {
		return workspaceNotLink, err
	}
	if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT == 0 {
		return workspaceNotLink, nil
	}

	handle, err := windows.CreateFile(
		pathPtr,
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		return workspaceNotLink, err
	}
	defer windows.CloseHandle(handle)

	tagInfo := workspaceFileAttributeTagInfo{}
	err = windows.GetFileInformationByHandleEx(
		handle,
		windows.FileAttributeTagInfo,
		(*byte)(unsafe.Pointer(&tagInfo)),
		uint32(unsafe.Sizeof(tagInfo)),
	)
	if err != nil {
		return workspaceNotLink, err
	}
	if tagInfo.reparseTag == windows.IO_REPARSE_TAG_SYMLINK {
		return workspaceSymbolicLink, nil
	}
	return workspaceOtherReparse, nil
}
