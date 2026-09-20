//go:build linux

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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

// evalAppearanceSymlinks 保留真实路径校验，兼容 Android 可访问子目录但不能查询父目录属性的情况。
func evalAppearanceSymlinks(name string) (string, error) {
	resolved, walkErr := filepath.EvalSymlinks(name)
	if walkErr == nil {
		return resolved, nil
	}
	if !os.IsNotExist(walkErr) && !os.IsPermission(walkErr) {
		return "", walkErr
	}

	// O_PATH 只取得路径句柄，不读取文件内容，也不会阻塞在命名管道上。
	fd, err := unix.Open(name, unix.O_PATH|unix.O_CLOEXEC, 0)
	if err != nil {
		return "", fmt.Errorf("%w; open path: %v", walkErr, err)
	}
	file := os.NewFile(uintptr(fd), name)
	defer file.Close()
	resolved, err = os.Readlink("/proc/self/fd/" + strconv.Itoa(fd))
	if err != nil {
		return "", fmt.Errorf("%w; read path link: %v", walkErr, err)
	}
	if !filepath.IsAbs(resolved) {
		return "", fmt.Errorf("resolved appearance path is not absolute: %q", resolved)
	}
	// 确认内核返回的路径仍指向同一个对象，拒绝已经删除或被替换的目标。
	openedInfo, err := file.Stat()
	if err != nil {
		return "", err
	}
	resolvedInfo, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !os.SameFile(openedInfo, resolvedInfo) {
		return "", fmt.Errorf("resolved appearance path changed: %q", resolved)
	}
	return resolved, nil
}
