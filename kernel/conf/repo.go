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

package conf

import (
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type Repo struct {
	Key []byte `json:"key"` // AES 密钥

	// 同步索引计时，单位毫秒，超过该时间则提示用户索引性能下降
	// If the data repo indexing time is greater than 12s, prompt user to purge the data repo https://github.com/siyuan-note/siyuan/issues/9613
	// Supports configuring data sync index time-consuming prompts https://github.com/siyuan-note/siyuan/issues/9698
	SyncIndexTiming int64 `json:"syncIndexTiming"`
}

func NewRepo() *Repo {
	return &Repo{
		SyncIndexTiming: 12 * 1000,
	}
}

func (*Repo) GetSaveDir() string {
	return filepath.Join(util.WorkspaceDir, "repo")
}
