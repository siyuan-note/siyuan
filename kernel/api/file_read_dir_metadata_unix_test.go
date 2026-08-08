//go:build linux || darwin

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const readDirTimeoutWorkerEnv = "SIYUAN_TEST_READ_DIR_TIMEOUT_WORKER"

func TestOpenReadDirDirectoryRejectsFIFOWithoutBlocking(t *testing.T) {
	if os.Getenv(readDirTimeoutWorkerEnv) == "" {
		runBoundedReadDirWorker(t, "open-directory-fifo")
		return
	}

	workspace := t.TempDir()
	fifo := filepath.Join(workspace, "fifo")
	if err := unix.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(workspace)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	file, openErr := openReadDirDirectory(root, "fifo")
	if file != nil {
		_ = file.Close()
		t.Fatal("FIFO was opened as a directory")
	}
	if openErr == nil {
		t.Fatal("FIFO directory open unexpectedly succeeded")
	}
}

func runBoundedReadDirWorker(t *testing.T, worker string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.count=1")
	command.Env = append(os.Environ(), readDirTimeoutWorkerEnv+"="+worker)
	command.WaitDelay = 2 * time.Second
	output, err := command.CombinedOutput()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatalf("readDir timeout worker %q blocked; process was killed and joined: %v\n%s", worker, err, output)
	}
	if err != nil {
		t.Fatalf("readDir timeout worker %q failed: %v\n%s", worker, err, output)
	}
}

func TestReadDirSnapshotSpecialFileReplacementDoesNotBlock(t *testing.T) {
	if os.Getenv(readDirTimeoutWorkerEnv) == "" {
		runBoundedReadDirWorker(t, "snapshot-special-replacement")
		return
	}

	testCases := []struct {
		name            string
		initialType     string
		replacementType string
	}{
		{name: "regular-to-FIFO", initialType: "regular", replacementType: "fifo"},
		{name: "directory-to-FIFO", initialType: "directory", replacementType: "fifo"},
		{name: "regular-to-socket", initialType: "regular", replacementType: "socket"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			workspace := t.TempDir()
			directoryPath := filepath.Join(workspace, "directory")
			if err := os.Mkdir(directoryPath, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directoryPath, "A"), []byte("stable"), 0644); err != nil {
				t.Fatal(err)
			}
			victim := filepath.Join(directoryPath, "z")
			if testCase.initialType == "regular" {
				if err := os.WriteFile(victim, []byte("replace"), 0644); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Mkdir(victim, 0755); err != nil {
				t.Fatal(err)
			}

			root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
			replaced := false
			var replacementErr error
			var replacementSocket net.Listener
			t.Cleanup(func() {
				if replacementSocket != nil {
					_ = replacementSocket.Close()
				}
			})
			snapshotter := &readDirSnapshotter{
				root:              root,
				directory:         directory,
				directoryRelative: "directory",
				resolvedWorkspace: resolvedWorkspace,
				afterInitialStat: func(name string) {
					if name != "z" || replaced {
						return
					}
					replaced = true
					if replacementErr = os.Remove(victim); replacementErr != nil {
						return
					}
					if testCase.replacementType == "fifo" {
						replacementErr = unix.Mkfifo(victim, 0600)
					} else {
						replacementSocket, replacementErr = net.Listen("unix", victim)
					}
				},
			}

			snapshot, snapshotErr := snapshotter.read()
			if replacementErr != nil {
				t.Fatal(replacementErr)
			}
			if !errors.Is(snapshotErr, errReadDirEntryChanged) {
				t.Fatalf("special-file replacement returned %v", snapshotErr)
			}
			if snapshot != nil {
				t.Fatalf("special-file replacement returned partial snapshot: %#v", snapshot)
			}
		})
	}
}

func TestReadDirSnapshotDoesNotRequireFileContentReadPermission(t *testing.T) {
	const unprivilegedRunEnv = "SIYUAN_TEST_READ_DIR_UNPRIVILEGED"
	if os.Geteuid() == 0 && os.Getenv(unprivilegedRunEnv) == "" {
		executableDirectory, err := os.MkdirTemp("", "siyuan-read-dir-unprivileged-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(executableDirectory) })
		if err = os.Chmod(executableDirectory, 0755); err != nil {
			t.Fatal(err)
		}
		executablePath := filepath.Join(executableDirectory, "api.test")
		source, err := os.Open(os.Args[0])
		if err != nil {
			t.Fatal(err)
		}
		destination, err := os.OpenFile(executablePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
		if err != nil {
			_ = source.Close()
			t.Fatal(err)
		}
		_, copyErr := io.Copy(destination, source)
		sourceCloseErr := source.Close()
		destinationCloseErr := destination.Close()
		if copyErr != nil || sourceCloseErr != nil || destinationCloseErr != nil {
			t.Fatalf("copy test executable: copy=%v source-close=%v destination-close=%v", copyErr, sourceCloseErr, destinationCloseErr)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, executablePath, "-test.run=^TestReadDirSnapshotDoesNotRequireFileContentReadPermission$", "-test.count=1")
		command.Dir = executableDirectory
		command.Env = append(os.Environ(), unprivilegedRunEnv+"=1")
		command.SysProcAttr = &syscall.SysProcAttr{
			Credential: &syscall.Credential{Uid: 65534, Gid: 65534, Groups: []uint32{65534}},
		}
		command.WaitDelay = 2 * time.Second
		output, commandErr := command.CombinedOutput()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			t.Fatalf("unprivileged metadata listing blocked; process was killed and joined: %v\n%s", commandErr, output)
		}
		if commandErr != nil {
			t.Fatalf("unprivileged metadata listing failed: %v\n%s", commandErr, output)
		}
		return
	}

	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	victim := filepath.Join(directoryPath, "unreadable")
	if err := os.WriteFile(victim, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(victim, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(victim, 0600) })
	if content, err := os.Open(victim); err == nil {
		_ = content.Close()
		t.Skip("current user can open mode-000 files for content")
	}

	root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
	snapshot, err := readDirSnapshot(root, directory, "directory", resolvedWorkspace)
	if err != nil {
		t.Fatalf("metadata-only listing failed: %v", err)
	}
	if len(snapshot) != 1 || snapshot[0].name != "unreadable" || snapshot[0].isDir {
		t.Fatalf("unexpected metadata-only snapshot: %#v", snapshot)
	}
}
