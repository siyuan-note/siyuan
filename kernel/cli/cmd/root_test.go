// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestIsEncryptedNotebookWorkspacePathWith(t *testing.T) {
	workspace := filepath.Join(string(filepath.Separator), "workspace")
	data := filepath.Join(workspace, "data")
	isEncryptedBox := func(boxID string) bool { return boxID == "encrypted-box" }

	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "encrypted notebook root", path: filepath.Join("data", "encrypted-box"), want: true},
		{name: "encrypted notebook file", path: filepath.Join("data", "encrypted-box", "20240101000000-abcdefg.sy"), want: true},
		{name: "normal notebook", path: filepath.Join("data", "normal-box", "20240101000000-abcdefg.sy"), want: false},
		{name: "workspace data directory", path: "data", want: false},
		{name: "outside data directory", path: "temp", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isEncryptedNotebookWorkspacePathWith(test.path, workspace, data, isEncryptedBox); got != test.want {
				t.Fatalf("isEncryptedNotebookWorkspacePathWith(%q) = %v, want %v", test.path, got, test.want)
			}
		})
	}
}

func TestCLIRejectsEncryptedHistoryPaths(t *testing.T) {
	oldWorkspace, oldData, oldHistory := util.WorkspaceDir, util.DataDir, util.HistoryDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.HistoryDir = filepath.Join(util.WorkspaceDir, "history")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.HistoryDir = oldWorkspace, oldData, oldHistory
	})
	boxID := "20260907120000-history"
	historyDir := filepath.Join(util.HistoryDir, "2026-09-07-120000-delete", boxID)
	if err := os.MkdirAll(filepath.Join(historyDir, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(historyDir, ".siyuan", "conf.json"), []byte(`{"encrypted":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []*cobra.Command{historyGetCmd, historyRollbackCmd} {
		flag := cmd.Flags().Lookup("path")
		oldValue := flag.Value.String()
		t.Cleanup(func() { _ = flag.Value.Set(oldValue) })
		for _, historyPath := range []string{
			filepath.Join(historyDir, "20260907120001-history.sy"),
			filepath.Join("history", "2026-09-07-120000-delete", boxID, "20260907120001-history.sy"),
		} {
			if err := flag.Value.Set(historyPath); err != nil {
				t.Fatal(err)
			}
			if err := rejectEncryptedNotebookCLI(cmd, nil); err == nil {
				t.Fatalf("%s accepted encrypted history: %s", cmd.Name(), historyPath)
			}
		}
		if err := flag.Value.Set(filepath.Join("history", "2026-09-07-120000-update", "20260907130000-normal1", "20260907120001-history.sy")); err != nil {
			t.Fatal(err)
		}
		if err := rejectEncryptedNotebookCLI(cmd, nil); err != nil {
			t.Fatalf("%s rejected ordinary history: %v", cmd.Name(), err)
		}
	}
}
