// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/siyuan-note/logging"
)

func TestFileSysStatusCheckData(t *testing.T) {
	ids := map[string]bool{}
	pattern := regexp.MustCompile(`(?m)^Check ID: ([0-9a-f]{32})$`)
	for range 32 {
		data, err := newFileSysStatusCheckData()
		if err != nil {
			t.Fatal(err)
		}
		if len(data) != 4096 {
			t.Fatalf("data length = %d, want 4096", len(data))
		}
		for _, b := range data {
			if b != '\n' && (b < ' ' || b > '~') {
				t.Fatalf("non-text byte: %x", b)
			}
		}
		match := pattern.FindSubmatch(data)
		if match == nil || ids[string(match[1])] {
			t.Fatalf("missing or repeated check ID: %q", match)
		}
		ids[string(match[1])] = true
		var compressed bytes.Buffer
		writer := gzip.NewWriter(&compressed)
		if _, err = writer.Write(data); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		if compressed.Len() >= len(data)/4 {
			t.Fatalf("check data is not mostly repeated text: compressed length %d", compressed.Len())
		}
	}
}

func TestFileSysStatusCheckMissingFileDiagnostics(t *testing.T) {
	for _, operation := range []string{"open", "rename", "rename-back", "rename-target-parent", "open-parent"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			dir := filepath.Join(root, "filesys_status_check")
			if err := os.Mkdir(dir, 0755); err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(dir, "check_consistency")
			target := source + "_renamed"
			if operation == "rename-back" || operation == "open" || operation == "open-parent" {
				source, target = target, source
			}
			if err := os.WriteFile(source, []byte("check"), 0644); err != nil {
				t.Fatal(err)
			}
			if operation == "rename-target-parent" {
				parent := filepath.Join(root, "removed")
				if err := os.Mkdir(parent, 0755); err != nil {
					t.Fatal(err)
				}
				target = filepath.Join(parent, "check_consistency_renamed")
				if err := os.Remove(parent); err != nil {
					t.Fatal(err)
				}
			} else if operation == "open-parent" {
				if err := os.RemoveAll(dir); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Remove(source); err != nil {
				t.Fatal(err)
			}
			var err error
			if strings.HasPrefix(operation, "open") {
				var f *os.File
				f, err = os.Open(source)
				if f != nil {
					f.Close()
				}
			} else {
				err = os.Rename(source, target)
			}
			if !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("fault injection did not produce a missing-path error: %v", err)
			}
			wrapped := fileSysStatusCheckError(fmt.Errorf("probe operation: %w", err))
			if !errors.Is(wrapped, os.ErrNotExist) || !strings.Contains(wrapped.Error(), source) {
				t.Fatalf("missing original error or source path: %v", wrapped)
			}
			for _, text := range []string{"file or parent directory is missing", "may have been", "quarantined by security software"} {
				if !strings.Contains(wrapped.Error(), text) {
					t.Fatalf("missing diagnostic %q: %v", text, wrapped)
				}
			}
			if strings.HasPrefix(operation, "open") {
				var pathErr *os.PathError
				if !errors.As(wrapped, &pathErr) || pathErr.Path != source {
					t.Fatalf("lost PathError: %v", wrapped)
				}
			} else {
				var linkErr *os.LinkError
				if !errors.As(wrapped, &linkErr) || linkErr.Old != source || linkErr.New != target || !strings.Contains(wrapped.Error(), target) {
					t.Fatalf("lost rename paths: %v", wrapped)
				}
			}
		})
	}
}

func TestFileSysStatusCheckOtherErrorsUnchanged(t *testing.T) {
	for _, cause := range []error{os.ErrPermission, syscall.EIO, syscall.EBUSY, syscall.Errno(32)} {
		err := &os.PathError{Op: "open", Path: "check_consistency_renamed", Err: cause}
		if got := fileSysStatusCheckError(err); got != err {
			t.Fatalf("non-missing error changed: %v", got)
		}
	}
	if got := fileSysStatusCheckError(nil); got != nil {
		t.Fatalf("nil error changed: %v", got)
	}
}

func TestFileSysStatusCheckMissingFileStillExits(t *testing.T) {
	const rootEnv = "SIYUAN_TEST_FILESYS_CHECK_ROOT"
	if root := os.Getenv(rootEnv); root != "" {
		WorkspaceDir = root
		DataDir = filepath.Join(root, "data")
		logging.SetLogPath(filepath.Join(root, "check.log"))
		path := filepath.Join(DataDir, ".siyuan", "filesys_status_check", "check_consistency")
		go func() {
			// 等待探测文件创建并关闭写句柄，兼容不允许删除已打开文件的平台。
			var lastErr error
			for range 10000 {
				if lastErr = os.Remove(path); lastErr == nil {
					return
				}
				time.Sleep(time.Millisecond)
			}
			t.Errorf("could not remove probe: %v", lastErr)
		}()
		checkFileSysStatus()
		t.Fatal("missing probe did not terminate the process")
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestFileSysStatusCheckMissingFileStillExits$")
	cmd.Env = append(os.Environ(), rootEnv+"="+root)
	output, err := cmd.CombinedOutput()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != logging.ExitCodeFileSysErr {
		t.Fatalf("expected fatal file-system exit, got %v\n%s", err, output)
	}
	for _, text := range []string{"check_consistency", "check_consistency_renamed", "quarantined by security software"} {
		if !strings.Contains(string(output), text) {
			t.Fatalf("missing fatal diagnostic %q:\n%s", text, output)
		}
	}
}

func TestFileSysStatusCheckProtectionStructure(t *testing.T) {
	fileSet := token.NewFileSet()
	source, err := parser.ParseFile(fileSet, "runtime.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var body string
	for _, decl := range source.Decls {
		if function, ok := decl.(*ast.FuncDecl); ok && function.Name.Name == "checkFileSysStatus" {
			var formatted bytes.Buffer
			if err = format.Node(&formatted, fileSet, function.Body); err != nil {
				t.Fatal(err)
			}
			body = formatted.String()
		}
	}
	for _, fragment := range []string{
		"for range 7", "for range 32", "time.Sleep(5 * time.Second)", "RandomSleep(500, 1000)",
		`filepath.Join(dir, "check_consistency")`, `tmp + "_renamed"`,
		`!entry.IsDir() && strings.Contains(entry.Name(), "check_")`, "if 1 < len(lines)",
		"if IsCloudDrivePath(WorkspaceDir)", "checkFileSysStatusLock.TryLock()",
	} {
		if !strings.Contains(body, fragment) {
			t.Errorf("missing protection: %s", fragment)
		}
	}
	if strings.Count(body, "ReportFileSysFatalError(fileSysStatusCheckError(err))") != 3 || strings.Count(body, "ReportFileSysFatalError(") != 12 {
		t.Fatal("fatal error branches changed")
	}
	if strings.Count(body, "os.Rename(") != 2 || strings.Count(body, "os.Open(") != 1 || strings.Count(body, "newFileSysStatusCheckData()") != 1 {
		t.Fatal("probe operations changed")
	}
	var formatted bytes.Buffer
	if err = format.Node(&formatted, fileSet, source); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(formatted.String(), "thirdPartySyncCheckTicker = time.NewTicker(time.Minute * 10)") {
		t.Fatal("probe interval changed")
	}
}
