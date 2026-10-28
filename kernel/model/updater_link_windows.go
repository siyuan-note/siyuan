// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// createInstallPackageDirectoryLink 使用目录联接，无需符号链接权限或外部命令。
func createInstallPackageDirectoryLink(target, link string) (err error) {
	target, err = filepath.Abs(target)
	if err != nil {
		return err
	}
	name := "\\??\\" + target
	if after, ok := strings.CutPrefix(target, "\\\\"); ok {
		name = "\\??\\UNC\\" + after
	}
	substitute, err := windows.UTF16FromString(name)
	if err != nil {
		return err
	}
	printName, err := windows.UTF16FromString(target)
	if err != nil {
		return err
	}
	buffer := make([]byte, 16+2*(len(substitute)+len(printName)))
	if len(buffer) > windows.MAXIMUM_REPARSE_DATA_BUFFER_SIZE {
		return errors.New("install directory link target is too long")
	}
	binary.LittleEndian.PutUint32(buffer, windows.IO_REPARSE_TAG_MOUNT_POINT)
	binary.LittleEndian.PutUint16(buffer[4:], uint16(len(buffer)-8))
	binary.LittleEndian.PutUint16(buffer[10:], uint16(2*(len(substitute)-1)))
	binary.LittleEndian.PutUint16(buffer[12:], uint16(2*len(substitute)))
	binary.LittleEndian.PutUint16(buffer[14:], uint16(2*(len(printName)-1)))
	for i, value := range append(substitute, printName...) {
		binary.LittleEndian.PutUint16(buffer[16+2*i:], value)
	}
	if err = os.Mkdir(link, 0700); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(link)
		}
	}()
	linkName, err := windows.UTF16PtrFromString(link)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(linkName, windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	var returned uint32
	return windows.DeviceIoControl(handle, windows.FSCTL_SET_REPARSE_POINT, &buffer[0], uint32(len(buffer)),
		nil, 0, &returned, nil)
}
