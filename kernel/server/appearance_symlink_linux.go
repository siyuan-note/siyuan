// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux

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
