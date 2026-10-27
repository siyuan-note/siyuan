// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRemoveUnusedAssetsWithSourceValidation(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ORDINARY_ASSET_CLEANUP"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRemoveUnusedAssetsWithSourceValidation$", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	setupFileOperationTest(t)
	setupAttributeViewRefI18n(t)
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	util.ConfDir = t.TempDir()
	util.HistoryDir, util.TempDir = t.TempDir(), t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitAssetContentDatabase(true)
	sql.InitHistoryDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	for _, single := range []bool{true, false} {
		const relative = "assets/unused.txt"
		writeAssetRelinkTestFile(t, relative, []byte("attachment"))
		if single {
			removed, err := RemoveUnusedAsset(relative)
			if err != nil || removed != filepath.Join(util.DataDir, relative) {
				t.Fatalf("single cleanup: %s %v", removed, err)
			}
		} else {
			removed, err := RemoveUnusedAssets()
			if err != nil || len(removed) != 1 || removed[0] != filepath.Join(util.DataDir, relative) {
				t.Fatalf("batch cleanup: %v %v", removed, err)
			}
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, relative)); !os.IsNotExist(err) {
			t.Fatalf("unused attachment remains: %v", err)
		}
		backups, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", relative))
		if err != nil || len(backups) == 0 {
			t.Fatalf("missing backup: %v %v", backups, err)
		}
		data, err := os.ReadFile(backups[0])
		if err != nil || string(data) != "attachment" {
			t.Fatalf("invalid backup: %s %v", data, err)
		}
	}
}
