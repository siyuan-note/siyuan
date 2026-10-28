// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package testutil

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Junction 创建不需要管理员权限的真实目录联接。
func Junction(t testing.TB, link, target string) {
	t.Helper()
	if output, err := exec.Command("cmd", "/d", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("create junction %q to %q: %v, %s", link, target, err, output)
	}
}

// JunctionWorkspace 分别构造工作空间本身或其祖先为联接的夹具。
func JunctionWorkspace(t testing.TB, root string, atWorkspace bool) (alias, physical string) {
	t.Helper()
	physical = filepath.Join(root, "physical target")
	alias = filepath.Join(root, "linked path")
	if err := os.Mkdir(physical, 0755); err != nil {
		t.Fatal(err)
	}
	Junction(t, alias, physical)
	if !atWorkspace {
		alias, physical = filepath.Join(alias, "workspace"), filepath.Join(physical, "workspace")
		if err := os.Mkdir(physical, 0755); err != nil {
			t.Fatal(err)
		}
	}
	return
}
