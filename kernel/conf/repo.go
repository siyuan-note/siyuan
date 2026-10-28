// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

	// 自动清理数据仓库 Automatic purge for local data repo https://github.com/siyuan-note/siyuan/issues/13091
	IndexRetentionDays    int `json:"indexRetentionDays"`    // 索引保留天数
	RetentionIndexesDaily int `json:"retentionIndexesDaily"` // 每日保留索引数
}

func NewRepo() *Repo {
	return &Repo{
		SyncIndexTiming:       12 * 1000,
		IndexRetentionDays:    180,
		RetentionIndexesDaily: 2,
	}
}

func (*Repo) GetSaveDir() string {
	return filepath.Join(util.WorkspaceDir, "repo")
}
