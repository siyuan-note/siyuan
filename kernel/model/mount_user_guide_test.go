// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMountUserGuideAfterDeletion(t *testing.T) {
	const subprocessEnv = "SIYUAN_TEST_MOUNT_USER_GUIDE"
	if os.Getenv(subprocessEnv) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMountUserGuideAfterDeletion$", "-test.v")
		cmd.Env = append(os.Environ(), subprocessEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("user guide mount subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	// 使用最小内置指南副本，执行实际挂载、删除和再次挂载流程。
	util.WorkingDir = t.TempDir()
	for _, boxID := range userGuideIDs {
		t.Run(boxID, func(t *testing.T) {
			source := filepath.Join(util.WorkingDir, "guide", boxID)
			config := filepath.Join(source, documentaddressing.ConfigPath)
			if err := os.MkdirAll(filepath.Dir(config), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(config, []byte(`{"name":"User guide","closed":true}`), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "guide.txt"), []byte("bundled guide"), 0644); err != nil {
				t.Fatal(err)
			}
			if _, err := Mount(boxID); err != nil {
				t.Fatalf("first mount: %v", err)
			}
			for task.ContainIndexTask() {
				task.ExecTaskJob()
			}
			if err := filesys.CheckDocumentAddressing(boxID); err != nil {
				t.Fatal(err)
			}
			if err := RemoveBox(boxID); err != nil {
				t.Fatalf("delete guide: %v", err)
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, boxID)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("guide was not deleted: %v", err)
			}
			if err := RemoveBox(boxID); err != nil {
				t.Fatalf("repeat deletion of missing guide: %v", err)
			}
			if _, err := Mount(boxID); err != nil {
				t.Fatalf("reopen deleted guide: %v", err)
			}
			data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "guide.txt"))
			if err != nil || string(data) != "bundled guide" {
				t.Fatalf("guide content was not restored: %q, %v", data, err)
			}
			data, err = os.ReadFile(filepath.Join(util.DataDir, boxID, documentaddressing.ConfigPath))
			var fields map[string]any
			if err != nil || json.Unmarshal(data, &fields) != nil || fields["documentAddressingVersion"] != nil && fields["documentAddressingVersion"] != float64(2) {
				t.Fatalf("restored guide configuration is invalid: %s, %v", data, err)
			}
			if Conf.Box(boxID) == nil {
				t.Fatal("restored guide was not mounted")
			}
			for task.ContainIndexTask() {
				task.ExecTaskJob()
			}
			// 来源不兼容时，无论本地副本是否存在，都不能覆盖或创建副本。
			if err := os.WriteFile(filepath.Join(source, "20261026000000-future1.sy"), []byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 0644); err != nil {
				t.Fatal(err)
			}
			if _, err := Mount(boxID); !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatalf("incompatible bundled guide was accepted: %v", err)
			}
			if actual, err := os.ReadFile(filepath.Join(util.DataDir, boxID, documentaddressing.ConfigPath)); err != nil || string(actual) != string(data) {
				t.Fatalf("rejected source changed local config: %s, %v", actual, err)
			}
			if err := RemoveBox(boxID); err != nil {
				t.Fatal(err)
			}
			if _, err := Mount(boxID); !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatalf("missing guide bypassed source check: %v", err)
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, boxID)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("rejected source recreated guide: %v", err)
			}
		})
	}
	// 普通笔记本的已确认模式不能作为重新创建已删除源数据的依据。
	const ordinaryBox = "20260101120000-abcdefg"
	ordinaryDir := filepath.Join(util.DataDir, ordinaryBox)
	if err := os.MkdirAll(filepath.Join(ordinaryDir, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ordinaryDir, documentaddressing.ConfigPath), []byte(`{"documentAddressingVersion":2}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := filesys.CheckDocumentAddressing(ordinaryBox); err != nil {
		t.Fatal(err)
	}
	if err := removeBoxDir(ordinaryDir); err != nil {
		t.Fatal(err)
	}
	if _, err := Mount(ordinaryBox); err == nil {
		t.Fatalf("ordinary notebook bypassed missing-source check: %v", err)
	}
	if err := RemoveBox(ordinaryBox); err != nil {
		t.Fatalf("repeat deletion of missing ordinary notebook: %v", err)
	}
	if _, err := os.Stat(ordinaryDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("ordinary notebook was recreated: %v", err)
	}
}
