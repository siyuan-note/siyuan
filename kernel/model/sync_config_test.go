// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestCheckSyncPreservesEnabledWithoutUser(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	Conf.Sync.Load().Enabled = true
	t.Cleanup(func() {
		Conf = originalConf
	})

	if checkSync(false, false, true) {
		t.Fatal("sync must not start without a user")
	}
	if !Conf.Sync.Load().Enabled {
		t.Fatal("sync configuration must remain enabled without a user")
	}
}
