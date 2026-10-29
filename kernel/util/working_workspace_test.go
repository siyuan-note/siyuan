// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
)

func TestBootWorkspaceTempCleanup(t *testing.T) {
	for _, locked := range []bool{true, false} {
		t.Run(map[bool]string{true: "locked", false: "unlocked"}[locked], func(t *testing.T) {
			base := t.TempDir()
			workspace := filepath.Join(base, "workspace")
			var files []string
			for _, dir := range []string{"os", "repo", "export", "clipboard"} {
				filename := filepath.Join(workspace, "temp", dir, "active.txt")
				if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filename, []byte("active operation"), 0600); err != nil {
					t.Fatal(err)
				}
				files = append(files, filename)
			}
			if locked {
				lock := flock.New(filepath.Join(workspace, ".lock"))
				if ok, err := lock.TryLock(); err != nil || !ok {
					t.Fatalf("hold workspace lock: %v, %v", ok, err)
				}
				t.Cleanup(func() { _ = lock.Unlock() })
			}
			command := exec.Command(os.Args[0], "-test.run=^TestBootHomeDirProcess$", "--",
				"--home-dir="+filepath.Join(base, "home"), "--workspace="+workspace, "--wd="+base)
			command.Env = append(os.Environ(), "SIYUAN_TEST_BOOT_HOME="+filepath.Join(base, "system-home"))
			output, err := command.CombinedOutput()
			if locked {
				exit, ok := err.(*exec.ExitError)
				if !ok || exit.ExitCode() != logging.ExitCodeWorkspaceLocked {
					t.Fatalf("expected workspace lock rejection: %v\n%s", err, output)
				}
			} else if err != nil {
				t.Fatalf("boot failed: %v\n%s", err, output)
			}
			for _, filename := range files {
				data, err := os.ReadFile(filename)
				if locked && (err != nil || string(data) != "active operation") {
					t.Errorf("rejected startup changed %s: %q, %v", filename, data, err)
				} else if !locked && !os.IsNotExist(err) {
					t.Errorf("successful startup retained stale temp file %s: %v", filename, err)
				}
			}
		})
	}
}

func TestUnlockWorkspacePreservesLockIdentity(t *testing.T) {
	previousDir, previousLock := WorkspaceDir, WorkspaceLock
	t.Cleanup(func() { WorkspaceDir, WorkspaceLock = previousDir, previousLock })
	WorkspaceDir = t.TempDir()
	filename := filepath.Join(WorkspaceDir, ".lock")
	WorkspaceLock = flock.New(filename)
	if ok, err := WorkspaceLock.TryLock(); err != nil || !ok {
		t.Fatalf("first kernel failed to lock: %v, %v", ok, err)
	}
	t.Cleanup(func() { _ = WorkspaceLock.Unlock() })
	original, err := os.Stat(filename)
	if err != nil {
		t.Fatal(err)
	}
	UnlockWorkspace()
	if IsWorkspaceLocked(WorkspaceDir) {
		t.Fatal("released workspace is still reported as locked")
	}
	next := flock.New(filename)
	if ok, err := next.TryLock(); err != nil || !ok {
		t.Fatalf("next kernel failed to lock: %v, %v", ok, err)
	}
	defer next.Unlock()
	// A repeated cleanup from the old owner must leave the new owner protected.
	UnlockWorkspace()
	current, err := os.Stat(filename)
	if err != nil || !os.SameFile(original, current) {
		t.Fatalf("unlock replaced or removed the lock file: %v", err)
	}
	if !IsWorkspaceLocked(WorkspaceDir) {
		t.Fatal("next kernel's lock was bypassed")
	}
	third := flock.New(filename)
	defer third.Unlock()
	if ok, err := third.TryLock(); err != nil || ok {
		t.Fatalf("third kernel bypassed the held lock: %v, %v", ok, err)
	}
	if err = next.Unlock(); err != nil {
		t.Fatal(err)
	}
	if ok, err := third.TryLock(); err != nil || !ok {
		t.Fatalf("lock cannot be reused after handoff: %v, %v", ok, err)
	}
}
