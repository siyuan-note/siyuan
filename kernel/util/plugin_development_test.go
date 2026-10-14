// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPluginDevelopmentRawPathGuard(t *testing.T) {
	originalWorkspace, originalData, originalConf := WorkspaceDir, DataDir, ConfDir
	WorkspaceDir = t.TempDir()
	DataDir, ConfDir = filepath.Join(WorkspaceDir, "data"), filepath.Join(WorkspaceDir, "conf")
	t.Cleanup(func() { WorkspaceDir, DataDir, ConfDir = originalWorkspace, originalData, originalConf })
	for _, rel := range []string{
		"data/storage/ai/agent/plugin-projects/task/source/index.js",
		"data/storage/ai/agent/plugin-projects/task/artifacts/package.zip",
		"conf/plugin-development/task/checkpoints/index.js",
		"conf/plugin-development/install-backups/code.zip",
		"data/storage/ai/agent/sessions/task/runtime.json",
		"data/storage/ai/agent/sessions/task/runtime.jsona1b2c3d.tmp",
		"data/storage/ai/agent/sessions/task/runtime.json::$DATA",
		"data/storage/ai/agent/sessions/task/runtime.json. ",
		"data/storage/ai/agent/plugin-projects. /task/source/index.js",
		"conf/plugin-development::$INDEX_ALLOCATION/task/control.json",
		"data/plugins/.siyuan-package-install-abcdef/staging/index.js",
	} {
		path := filepath.Join(WorkspaceDir, filepath.FromSlash(rel))
		if !IsPluginDevelopmentRawPathForbidden(path, false) || !IsForbiddenAbsPath(path) {
			t.Errorf("protected path accepted: %s", rel)
		}
		// Windows 别名路径只验证词法保护，实体夹具仍使用合法路径。
		if runtime.GOOS == "windows" && (strings.Contains(rel, ":") || strings.Contains(rel, ". ")) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("private fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range []string{".", "data", "data/plugins", "data/storage", "data/storage/ai/agent", "data/storage/ai/agent/sessions/task", "conf"} {
		if !IsPluginDevelopmentRawPathForbidden(filepath.Join(WorkspaceDir, rel), true) {
			t.Errorf("protected ancestor mutation accepted: %s", rel)
		}
	}
	for _, rel := range []string{"data/storage/ai/agent/sessions/task/output/full.txt", "data/storage/ai/agent/sessions/task/session.json", "data/plugins/example/index.js", "temp/scratch.js"} {
		if IsPluginDevelopmentRawPathForbidden(filepath.Join(WorkspaceDir, rel), false) {
			t.Errorf("ordinary read rejected: %s", rel)
		}
	}
	link := filepath.Join(WorkspaceDir, "alias")
	if err := os.Symlink(PluginProjectsDir(), link); err == nil {
		if !IsPluginDevelopmentRawPathForbidden(filepath.Join(link, "task", "source", "new.js"), false) {
			t.Fatal("missing-leaf symlink alias bypassed protection")
		}
	}
	for _, rel := range []string{"storage/ai/agent/plugin-projects/task/source/index.js", "storage/ai/agent/sessions/task/runtime.json", "storage/ai/agent/sessions/task/runtime.jsona1b2c3d.tmp", "plugins/.siyuan-package-install-abc/staging/index.js"} {
		if !IsForbiddenDataRelPath(rel) {
			t.Errorf("history path accepted: %s", rel)
		}
	}
}

func TestPluginDevelopmentContextCannotBeForged(t *testing.T) {
	if _, err := RequirePluginDevelopment(context.Background(), "write"); err == nil {
		t.Fatal("missing context authorized")
	}
	calls := 0
	ctx := WithPluginDevelopmentAccess(context.Background(), func(operation string) (*PluginDevelopmentGrant, error) {
		calls++
		return &PluginDevelopmentGrant{SessionID: "session", TaskID: "task", AllowFiles: []string{"index.js"}}, nil
	})
	grant, err := RequirePluginDevelopment(ctx, "read")
	if err != nil {
		t.Fatal(err)
	}
	grant.AllowFiles[0] = "tampered.js"
	next, err := RequirePluginDevelopment(ctx, "write")
	if err != nil || next.AllowFiles[0] != "index.js" || calls != 2 {
		t.Fatal("grant was cached or aliased")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = RequirePluginDevelopment(canceled, "write"); err == nil || calls != 2 {
		t.Fatal("cancelled context authorized")
	}
}

func TestPluginDevelopmentReadOnlyRechecksBeforeGrant(t *testing.T) {
	original := ReadOnly
	ReadOnly = true
	t.Cleanup(func() { ReadOnly = original })
	calls := 0
	ctx := WithPluginDevelopmentAccess(context.Background(), func(string) (*PluginDevelopmentGrant, error) {
		calls++
		return &PluginDevelopmentGrant{SessionID: "session", TaskID: "task"}, nil
	})
	for _, operation := range []string{"write", "recover", "recovered"} {
		if _, err := RequirePluginDevelopment(ctx, operation); err == nil {
			t.Errorf("read-only allowed %s", operation)
		}
	}
	if calls != 0 {
		t.Fatal("read-only check invoked or consumed the grant")
	}
	for _, operation := range []string{"read", "load"} {
		if _, err := RequirePluginDevelopment(ctx, operation); err != nil {
			t.Fatalf("read-only blocked %s: %v", operation, err)
		}
	}
	if calls != 2 {
		t.Fatal("read operations did not reach the grant checker")
	}
}
