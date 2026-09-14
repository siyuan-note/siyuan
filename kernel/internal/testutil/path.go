// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package testutil

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// PublicDataDir 创建不受系统敏感目录限制的独立夹具，并在测试结束后清理。
// 显式选择父目录，避免 TMPDIR 和 GOTMPDIR 改变普通用户数据的安全属性。
func PublicDataDir(t testing.TB) string {
	t.Helper()
	home, _ := os.UserHomeDir()
	cwd, _ := os.Getwd()
	parents := []string{home, cwd, filepath.VolumeName(cwd) + string(filepath.Separator)}
	for _, parent := range parents {
		if parent == "" {
			continue
		}
		resolved, err := filepath.EvalSymlinks(parent)
		if err != nil || util.IsSensitivePath(filepath.Join(resolved, "siyuan-test-data")) {
			continue
		}
		dir, err := os.MkdirTemp(resolved, "siyuan-test-data-")
		if err != nil {
			continue
		}
		t.Cleanup(func() {
			if err := os.RemoveAll(dir); err != nil {
				t.Errorf("remove public data fixture %q: %v", dir, err)
			}
		})
		if util.IsSensitivePath(dir) {
			t.Fatalf("public data fixture is sensitive: %q", dir)
		}
		return dir
	}
	t.Fatalf("cannot create a non-sensitive public data fixture under any of %q", parents)
	return ""
}
