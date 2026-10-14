// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHomeDirCLI(t *testing.T) {
	home := t.TempDir()
	registered := filepath.Join(t.TempDir(), "registered-workspace")
	if err := os.MkdirAll(registered, 0755); err != nil {
		t.Fatal(err)
	}
	confDir := filepath.Join(home, ".config", "siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal([]string{registered})
	if err := os.WriteFile(filepath.Join(confDir, "workspace.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	for _, command := range []string{"list", "info"} {
		t.Run(command, func(t *testing.T) {
			process := exec.Command(os.Args[0], "-test.run=^TestHomeDirCLIProcess$", "--",
				"--home-dir="+home, "workspace", command)
			process.Env = append(os.Environ(), "SIYUAN_TEST_HOME_CLI=1", "SIYUAN_WORKSPACE_PATH=")
			output, err := process.CombinedOutput()
			if err != nil || !strings.Contains(string(output), registered) {
				t.Fatalf("workspace %s ignored --home-dir: %v\n%s", command, err, output)
			}
		})
	}
}

func TestHomeDirServeFlag(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_HOME_SERVE_FLAG") == "" {
		process := exec.Command(os.Args[0], "-test.run=^TestHomeDirServeFlag$")
		process.Env = append(os.Environ(), "SIYUAN_TEST_HOME_SERVE_FLAG=1")
		if output, err := process.CombinedOutput(); err != nil {
			t.Fatalf("serve home flag check failed: %v\n%s", err, output)
		}
		return
	}
	oldHome, oldPath, oldWorkspace, oldWd := util.HomeDir, homeDirPath, workspacePath, serveWdPath
	homeFlag := rootCmd.PersistentFlags().Lookup("home-dir")
	workspaceFlag := rootCmd.PersistentFlags().Lookup("workspace")
	wdFlag := serveCmd.Flags().Lookup("wd")
	oldHomeChanged, oldWorkspaceChanged, oldWdChanged := homeFlag.Changed, workspaceFlag.Changed, wdFlag.Changed
	t.Cleanup(func() {
		util.HomeDir, homeDirPath, workspacePath, serveWdPath = oldHome, oldPath, oldWorkspace, oldWd
		homeFlag.Changed, workspaceFlag.Changed, wdFlag.Changed = oldHomeChanged, oldWorkspaceChanged, oldWdChanged
	})
	home, workspace, wd := t.TempDir(), t.TempDir(), t.TempDir()
	if err := serveCmd.ParseFlags([]string{"--home-dir=" + home, "--workspace=" + workspace, "--wd=" + wd}); err != nil {
		t.Fatal(err)
	}
	if err := serveCmd.PersistentPreRunE(serveCmd, nil); err != nil {
		t.Fatal(err)
	}
	if util.HomeDir != home || workspacePath != workspace || serveWdPath != wd {
		t.Fatalf("flags were not kept independent: home=%q, workspace=%q, wd=%q", util.HomeDir, workspacePath, serveWdPath)
	}
	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	homeDirPath = file
	if err := serveCmd.PersistentPreRunE(serveCmd, nil); err == nil {
		t.Fatal("serve accepted an invalid home before boot")
	}
	if util.HomeDir != home {
		t.Fatal("invalid home changed the active profile")
	}
}

// TestHomeDirCLIProcess 在独立测试进程中执行离线命令，不启动内核服务。
func TestHomeDirCLIProcess(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_HOME_CLI") == "" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			rootCmd.SetArgs(os.Args[i+1:])
			break
		}
	}
	if err := Execute(); err != nil {
		t.Fatal(err)
	}
}
