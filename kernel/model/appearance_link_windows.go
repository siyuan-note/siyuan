package model

import (
	"encoding/binary"
	"errors"
	"os"
	"strings"

	"golang.org/x/sys/windows"
)

// resolveAppearanceDirectoryLink 通过目录句柄解析符号链接及目录联接的完整链路。
func resolveAppearanceDirectoryLink(link string) (string, error) {
	directory, err := os.Open(link)
	if err != nil {
		return "", err
	}
	defer directory.Close()
	buffer := make([]uint16, 260)
	for {
		n, err := windows.GetFinalPathNameByHandle(windows.Handle(directory.Fd()), &buffer[0], uint32(len(buffer)), 0)
		if err != nil {
			return "", err
		}
		if n < uint32(len(buffer)) {
			return windows.UTF16ToString(buffer[:n]), nil
		}
		buffer = make([]uint16, n+1)
	}
}

// createAppearanceDirectoryLink 使用目录联接兼容未启用符号链接权限的开发环境。
func createAppearanceDirectoryLink(target, link string) (err error) {
	if err = os.Symlink(target, link); err == nil || !errors.Is(err, windows.ERROR_PRIVILEGE_NOT_HELD) {
		return err
	}
	substitute := `\??\` + target
	if strings.HasPrefix(target, `\\?\`) {
		substitute = `\??\` + target[4:]
	} else if strings.HasPrefix(target, `\\`) {
		substitute = `\??\UNC\` + target[2:]
	}
	name, err := windows.UTF16FromString(substitute)
	if err != nil {
		return err
	}
	printName, err := windows.UTF16FromString(target)
	if err != nil {
		return err
	}
	// 目录联接缓冲区包含 8 字节头、8 字节路径偏移，以及两个以零结尾的 UTF-16 路径。
	data := make([]byte, 16+2*(len(name)+len(printName)))
	if len(data) > windows.MAXIMUM_REPARSE_DATA_BUFFER_SIZE {
		return windows.ERROR_FILENAME_EXCED_RANGE
	}
	binary.LittleEndian.PutUint32(data, windows.IO_REPARSE_TAG_MOUNT_POINT)
	binary.LittleEndian.PutUint16(data[4:], uint16(len(data)-8))
	binary.LittleEndian.PutUint16(data[10:], uint16(2*(len(name)-1)))
	binary.LittleEndian.PutUint16(data[12:], uint16(2*len(name)))
	binary.LittleEndian.PutUint16(data[14:], uint16(2*(len(printName)-1)))
	for i, c := range append(name, printName...) {
		binary.LittleEndian.PutUint16(data[16+2*i:], c)
	}
	if err = os.Mkdir(link, 0755); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(link)
		}
	}()
	extended := link
	if !strings.HasPrefix(extended, `\\?\`) {
		if strings.HasPrefix(extended, `\\`) {
			extended = `\\?\UNC\` + extended[2:]
		} else {
			extended = `\\?\` + extended
		}
	}
	path, err := windows.UTF16PtrFromString(extended)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	var returned uint32
	return windows.DeviceIoControl(handle, windows.FSCTL_SET_REPARSE_POINT, &data[0], uint32(len(data)), nil, 0, &returned, nil)
}
