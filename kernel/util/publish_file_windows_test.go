// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package util_test

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishFileJunctionBoundary(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "public"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	junction := filepath.Join(root, "public", "linked")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", junction, outside).CombinedOutput(); err != nil {
		t.Skipf("junction creation unavailable: %v %s", err, out)
	}
	if file, err := util.OpenPublishFile(root, "public/linked/secret.txt"); err == nil {
		file.Close()
		t.Fatal("junction target was exposed")
	}
}

// TestPublishFileShortName 验证短文件名不能绕过包资源的敏感路径检查，同时保留普通资源与公开目录的读取。
func TestPublishFileShortName(t *testing.T) {
	root := t.TempDir()
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = root
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })
	dir := filepath.Join(root, "widgets", "example")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"credentials.json", "id_private_token.json", "ordinary-resource-file.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
		t.Run(name, func(t *testing.T) {
			short := filepath.Base(testutil.ShortPath(t, filepath.Join(dir, name)))
			file, err := util.OpenPublishReaderFile(root, "widgets/example/"+short)
			if name != "ordinary-resource-file.txt" {
				if file != nil {
					file.Close()
				}
				if !errors.Is(err, fs.ErrPermission) {
					t.Fatalf("sensitive alias %s: err = %v, want permission denied", short, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ordinary alias rejected: %v", err)
			}
			defer file.Close()
			data, err := io.ReadAll(file)
			if err != nil || string(data) != name {
				t.Fatalf("ordinary alias content = %q, err = %v", data, err)
			}
		})
	}
	t.Run("public directory", func(t *testing.T) {
		public := filepath.Join(root, "public")
		if err := os.MkdirAll(public, 0755); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(public, "credentials.json")
		if err := os.WriteFile(path, []byte("explicitly public"), 0644); err != nil {
			t.Fatal(err)
		}
		short := filepath.Base(testutil.ShortPath(t, path))
		file, err := util.OpenPublishFile(root, "public/"+short)
		if err != nil {
			t.Fatalf("explicitly public alias rejected: %v", err)
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil || string(data) != "explicitly public" {
			t.Fatalf("public alias content = %q, err = %v", data, err)
		}
	})
}
