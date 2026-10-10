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

package util

import (
	"bytes"
	"errors"
	"fmt"
	"os"

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
