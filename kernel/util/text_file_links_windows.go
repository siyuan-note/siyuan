// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"os"

	"golang.org/x/sys/windows"
)

func openTextFileRead(root *os.Root, name string) (*os.File, error) {
	// Root.OpenFile 支持此 Windows 标志并返回重解析点自身的句柄，调用方读取前拒绝非常规文件类型。
	return root.OpenFile(name, os.O_RDONLY|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
}

func textFileSingleLink(file *os.File, _ os.FileInfo) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &info); err != nil {
		return err
	}
	if info.NumberOfLinks != 1 {
		return textFileError("invalid_path", "hard-linked files are not supported")
	}
	return nil
}
