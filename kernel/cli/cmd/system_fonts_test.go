// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestSystemFontsSkipsWorkspaceInitialization(t *testing.T) {
	oldLogPath := logging.LogPath
	t.Cleanup(func() { logging.SetLogPath(oldLogPath); logging.SetLogToStdout(true) })
	root := &cobra.Command{Use: "kernel", SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE:  func(*cobra.Command, []string) error { t.Fatal("initialized workspace"); return nil },
		PersistentPostRunE: func(*cobra.Command, []string) error { t.Fatal("flushed database"); return nil },
	}
	system := &cobra.Command{Use: "system"}
	root.AddCommand(system)
	originalLanguage := util.Lang
	system.AddCommand(newSystemFontsCmd(func() []*util.Font {
		if util.Lang != "zh-CN" {
			t.Fatalf("language = %q", util.Lang)
		}
		return []*util.Font{{Family: "Sample", Weight: 500, DisplayName: "字体", Aliases: []string{"Sample Medium"}, Spacing: "monospace"}}
	}))
	var stdout bytes.Buffer
	root.SetOut(&stdout)
	root.SetArgs([]string{"system", "fonts", "--lang", "zh_CN"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if util.Lang != originalLanguage {
		t.Fatal("language was not restored")
	}
	decoder := json.NewDecoder(&stdout)
	var fonts []*util.Font
	if err := decoder.Decode(&fonts); err != nil {
		t.Fatal(err)
	}
	if len(fonts) != 1 || fonts[0].DisplayName != "字体" || fonts[0].Weight != 500 || fonts[0].Spacing != "monospace" {
		t.Fatalf("fonts = %#v", fonts)
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		t.Fatalf("unexpected stdout after JSON: %v", err)
	}
}

func TestSystemFontsLanguageValidationAndEmptyList(t *testing.T) {
	oldLogPath := logging.LogPath
	t.Cleanup(func() { logging.SetLogPath(oldLogPath); logging.SetLogToStdout(true) })
	for _, language := range []string{"en", "zh-CN", "zh_CN", "pt-BR", "ja"} {
		command := newSystemFontsCmd(func() []*util.Font { return nil })
		var output bytes.Buffer
		command.SetOut(&output)
		command.SetArgs([]string{"--lang", language})
		if err := command.Execute(); err != nil {
			t.Fatal(err)
		}
		if output.String() != "[]\n" {
			t.Fatalf("output = %q", output.String())
		}
	}
	for _, args := range [][]string{{"--lang", "../../conf"}, {"--lang", ""}, {"extra"}} {
		command := newSystemFontsCmd(func() []*util.Font { t.Fatal("invalid arguments reached scanner"); return nil })
		command.SilenceUsage, command.SilenceErrors = true, true
		command.SetArgs(args)
		if err := command.Execute(); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}

func TestSystemFontsProcess(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_FONT_PROCESS") == "1" {
		rootCmd.SetArgs([]string{"system", "fonts", "--lang", "zh-CN"})
		if err := rootCmd.Execute(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	directory := t.TempDir()
	home := filepath.Join(directory, "home")
	cwd := filepath.Join(directory, "cwd")
	for _, dir := range []string{home, cwd} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "-test.run=^TestSystemFontsProcess$")
	command.Dir = cwd
	command.Env = append(os.Environ(), "SIYUAN_TEST_FONT_PROCESS=1", "HOME="+home, "USERPROFILE="+home, "XDG_CACHE_HOME="+filepath.Join(home, ".cache"), "SIYUAN_WORKSPACE_PATH="+filepath.Join(directory, "absent-workspace"))
	stdout, err := command.Output()
	if err != nil {
		t.Fatalf("font tool failed: %v", err)
	}
	var fonts []*util.Font
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	if err := decoder.Decode(&fonts); err != nil {
		t.Fatalf("font tool stdout is not JSON: %v\n%s", err, stdout)
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		t.Fatalf("font tool emitted extra stdout: %v", err)
	}
	for _, dir := range []string{home, cwd} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			// 系统字体枚举可能刷新 Fontconfig 缓存，但不应创建思源配置或工作空间。
			if dir == home && runtime.GOOS == "linux" && entry.IsDir() && entry.Name() == ".fontconfig" {
				continue
			}
			if dir == home && runtime.GOOS == "linux" && entry.IsDir() && entry.Name() == ".cache" {
				cached, err := os.ReadDir(filepath.Join(home, ".cache"))
				if err != nil {
					t.Fatal(err)
				}
				if len(cached) == 1 && cached[0].IsDir() && cached[0].Name() == "fontconfig" {
					continue
				}
			}
			t.Fatalf("font tool wrote unexpected file to %s: %s", dir, entry.Name())
		}
	}
	if _, err := os.Stat(filepath.Join(directory, "absent-workspace")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("font tool created workspace: %v", err)
	}
}
