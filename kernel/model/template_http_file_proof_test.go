// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestTemplateHTTPFileProofStableAndBoundToFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "template.md")
	if err := os.WriteFile(path, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	first, supported, err := templateHTTPFileProof(file)
	if err != nil {
		t.Fatal(err)
	}
	if !supported {
		if first != "" {
			t.Fatal("unsupported platform returned a trusted proof")
		}
		return
	}
	second, supported, err := templateHTTPFileProof(file)
	if err != nil || !supported || second != first || len(first) != 64 {
		t.Fatalf("unstable proof: %q, %q, %v", first, second, err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(filepath.Dir(path), "copy.md")
	if err = os.WriteFile(copyPath, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(copyPath, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	copyFile, err := os.Open(copyPath)
	if err != nil {
		t.Fatal(err)
	}
	defer copyFile.Close()
	copyProof, supported, err := templateHTTPFileProof(copyFile)
	if err != nil || !supported || copyProof == first {
		t.Fatalf("copied file inherited identity: %q %v", copyProof, err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, supported, err = templateHTTPFileProof(file); err == nil || supported {
		t.Fatal("closed descriptor supplied a trusted proof")
	}
}

func TestTemplateHTTPFileProofDetectsRestoredMtimeWrite(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "android" && runtime.GOOS != "darwin" && runtime.GOOS != "ios" {
		t.Skip("change-time identity applies to Unix implementations")
	}
	path := filepath.Join(t.TempDir(), "template.md")
	if err := os.WriteFile(path, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	before, supported, err := templateHTTPFileProof(file)
	if err != nil || !supported {
		t.Fatalf("missing platform proof: %v", err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	if err = os.WriteFile(path, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	after, supported, err := templateHTTPFileProof(file)
	if err != nil || !supported || before == after {
		t.Fatalf("same-byte rewrite with restored mtime retained proof: %q %v", after, err)
	}
}
