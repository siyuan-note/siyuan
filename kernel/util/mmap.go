// SiYuan - Refactor your thinking
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
	"errors"
	"fmt"
	"os"

	mmap "github.com/edsrzf/mmap-go"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

// WriteFileByMmap 使用内存映射将 data 原地覆写到 filePath。
//
// 流程：OpenFile(O_RDWR|O_CREATE) → Truncate 到精确长度 → mmap.Map(RDWR) →
// copy 写入 → Flush → Unmap，全程持有 filelock 的进程内互斥锁，避免并发写冲突。
//
// 相比 filelock.WriteFile（临时文件 + rename + fsync），此路径在进程级 I/O
// 计数（IO Write Bytes）上几乎不计——copy 是纯内存写，不经过 I/O 子系统，
// 只有 Flush 会产生极少量计入。出错时由调用方回退到 filelock.WriteFile。
func WriteFileByMmap(filePath string, data []byte) (err error) {
	f, err := filelock.OpenFile(filePath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return
	}
	defer filelock.CloseFile(f)

	if err = f.Truncate(int64(len(data))); err != nil {
		msg := fmt.Sprintf("truncate file [%s] failed: %s", filePath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	m, err := mmap.Map(f, mmap.RDWR, 0)
	if err != nil {
		msg := fmt.Sprintf("map file [%s] failed: %s", filePath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	defer m.Unmap()

	copy(m, data)
	if err = m.Flush(); err != nil {
		msg := fmt.Sprintf("flush data [%s] failed: %s", filePath, err)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	return
}
