// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build windows

package model

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// ResolveRealPath 使用文件句柄解析符号链接和目录联接，返回现有文件的最终绝对路径。
func ResolveRealPath(path string) (string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	pathUTF16, err := windows.UTF16PtrFromString(absPath)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(
		pathUTF16,
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = windows.CloseHandle(handle)
	}()

	buffer := make([]uint16, 512)
	for {
		length, callErr := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
		if callErr != nil {
			return "", callErr
		}
		if length < uint32(len(buffer)) {
			resolved := windows.UTF16ToString(buffer[:length])
			switch {
			case strings.HasPrefix(resolved, `\\?\UNC\`):
				resolved = `\\` + strings.TrimPrefix(resolved, `\\?\UNC\`)
			case len(resolved) > 5 && strings.HasPrefix(resolved, `\\?\`) && resolved[5] == ':':
				resolved = strings.TrimPrefix(resolved, `\\?\`)
			}
			return filepath.Clean(resolved), nil
		}
		buffer = make([]uint16, length+1)
	}
}
