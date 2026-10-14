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

package util

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
)

func newFileSysStatusCheckData() ([]byte, error) {
	// 每批使用独立的随机标识，其余内容填充为普通文本，保持探测文件大小不变。
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	data := make([]byte, 4096)
	offset := copy(data, fmt.Sprintf("SiYuan file system consistency check\nCheck ID: %x\n", id))
	const line = "SiYuan uses this temporary file to check file system consistency.\n"
	for offset < len(data) {
		offset += copy(data[offset:], line)
	}
	return data, nil
}

func fileSysStatusCheckError(err error) error {
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// 保留原始操作和完整路径；不存在错误也可能来自父目录，不能据此断定文件被隔离。
	return fmt.Errorf("file system check file or parent directory is missing; it may have been removed by another program or quarantined by security software; check the paths and quarantine records: %w", err)
}
