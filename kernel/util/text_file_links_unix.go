// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package util

import (
	"os"
	"reflect"
	"syscall"
)

func openTextFileRead(root *os.Root, name string) (*os.File, error) {
	// 路径被换成 FIFO 时不能在句柄类型检查前阻塞；最后一个分量即使链接到同一根目录内也不跟随。
	return root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
}

func textFileSingleLink(_ *os.File, info os.FileInfo) error {
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if value.IsValid() && value.Kind() == reflect.Struct {
		links := value.FieldByName("Nlink")
		if links.IsValid() {
			if (links.CanUint() && links.Uint() == 1) || (links.CanInt() && links.Int() == 1) {
				return nil
			}
		}
	}
	return textFileError(TextFileInvalidPath, "hard-linked files or unknown link counts are not supported")
}
