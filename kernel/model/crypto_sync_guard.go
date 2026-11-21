// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func EncryptedNotebookDisableBlockedBySync() bool {
	if Conf.Sync.Load().HasConfiguredSync() {
		return true
	}
	return hasLegacySyncReference()
}

func hasLegacySyncReference() bool {
	if util.RepoDir == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(util.RepoDir, "refs", "latest-sync"))
	return !errors.Is(err, os.ErrNotExist)
}

func enrollLegacySyncAssociation(config *AppConf) {
	if hasLegacySyncReference() {
		config.Sync.Load().Configured = true
	}
}
