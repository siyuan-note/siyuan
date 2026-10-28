// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func cloudSyncContract(value *model.Sync) *apicontract.CloudSync {
	if value == nil {
		return nil
	}
	return &apicontract.CloudSync{Size: value.Size, HSize: value.HSize, Updated: value.Updated, CloudName: value.CloudName, SaveDir: value.SaveDir}
}

func cloudBackupContract(value *model.Backup) *apicontract.CloudBackup {
	if value == nil {
		return nil
	}
	return &apicontract.CloudBackup{Size: value.Size, HSize: value.HSize, Updated: value.Updated, SaveDir: value.SaveDir}
}
