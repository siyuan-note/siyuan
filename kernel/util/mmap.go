// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"runtime"
	"time"

	mmap "github.com/edsrzf/mmap-go"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

// WriteFileByMmap 使用内存映射按页比较，只覆写发生变化的页，并立即刷新。
// 全程持有 filelock 的进程内互斥锁，长度变化时调整文件大小；出错时由调用方回退到原子写入。
func WriteFileByMmap(filePath string, data []byte) (err error) {
	f, err := filelock.OpenFile(filePath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return
	}
	defer filelock.CloseFile(f)

	return writeFileByMmap(f, data)
}

// writeFileByMmap 的调用方持有文件锁，并在返回后关闭文件。
func writeFileByMmap(f *os.File, data []byte) (err error) {
	filePath := f.Name()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	sizeChanged := info.Size() != int64(len(data))
	if sizeChanged {
		if err = f.Truncate(int64(len(data))); err != nil {
			msg := fmt.Sprintf("truncate file [%s] failed: %s", filePath, err)
			logging.LogError(msg)
			err = errors.New(msg)
			return
		}
	}
	if len(data) == 0 {
		return f.Sync()
	}

	m, err := mmap.Map(f, mmap.RDWR, 0)
	if err != nil {
		msg := fmt.Sprintf("map file [%s] failed: %s", filePath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	defer m.Unmap()

	if copyChangedMmapPages(m, data, os.Getpagesize()) == 0 && !sizeChanged {
		return nil
	}
	if err = m.Flush(); err != nil {
		msg := fmt.Sprintf("flush data [%s] failed: %s", filePath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	// Windows 的映射写入不会自动更新时间，显式标记内容变更以供同步快照识别。
	if runtime.GOOS == "windows" {
		now := time.Now()
		if err = os.Chtimes(filePath, now, now); err != nil {
			return fmt.Errorf("update file modification time [%s]: %w", filePath, err)
		}
	}
	return
}

func copyChangedMmapPages(mapped, data []byte, pageSize int) (changedPages int) {
	for start := 0; start < len(data); start += pageSize {
		end := min(start+pageSize, len(data))
		if !bytes.Equal(mapped[start:end], data[start:end]) {
			copy(mapped[start:end], data[start:end])
			changedPages++
		}
	}
	return
}
