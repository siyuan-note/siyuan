// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSaveRestrictsConfFilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 由用户目录的访问控制保护，POSIX 权限不适用")
	}
	oldConf, oldConfDir, oldReadOnly := Conf, util.ConfDir, util.ReadOnly
	t.Cleanup(func() {
		Conf, util.ConfDir, util.ReadOnly = oldConf, oldConfDir, oldReadOnly
	})
	Conf, util.ConfDir, util.ReadOnly = NewAppConf(), t.TempDir(), false

	confPath := filepath.Join(util.ConfDir, "conf.json")
	if err := os.WriteFile(confPath, []byte(`{"lang":"en"}`), 0644); err != nil {
		t.Fatal(err)
	}
	Conf.AccessAuthCode = "lock-screen-password"
	Conf.Save()

	info, err := os.Stat(confPath)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); 0600 != perm {
		t.Fatalf("permission of conf.json is %#o, want 0600", perm)
	}
}
