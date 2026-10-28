// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package server

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestAppearanceDirectoryJunction(t *testing.T) {
	physical := filepath.Join(t.TempDir(), "physical target")
	appearance := filepath.Join(physical, "appearance")
	if err := os.MkdirAll(filepath.Join(appearance, "langs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appearance, "langs", "en.json"), []byte(`{"name":"English"}`), 0644); err != nil {
		t.Fatal(err)
	}
	linked := filepath.Join(t.TempDir(), "linked path")
	createAppearanceTestJunction(t, linked, physical)
	linkedAppearance := filepath.Join(linked, "appearance")

	resolved, err := evalAppearanceSymlinks(linkedAppearance)
	if err != nil {
		t.Fatal(err)
	}
	resolvedInfo, err := os.Stat(resolved)
	if err != nil {
		t.Fatal(err)
	}
	physicalInfo, err := os.Stat(appearance)
	if err != nil || !os.SameFile(resolvedInfo, physicalInfo) {
		t.Fatalf("resolved path %q does not match appearance directory: %v", resolved, err)
	}

	resource, status := resolveAppearanceFilePath(linkedAppearance, "langs/en.json")
	if status != 0 {
		t.Fatalf("junction resource status = %d", status)
	}
	if data, readErr := os.ReadFile(resource); readErr != nil || string(data) != `{"name":"English"}` {
		t.Fatalf("junction resource = %q, %v", data, readErr)
	}

	outside := t.TempDir()
	if err = os.WriteFile(filepath.Join(outside, "secret.json"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	createAppearanceTestJunction(t, filepath.Join(appearance, "langs", "escape"), outside)
	if _, status = resolveAppearanceFilePath(linkedAppearance, "langs/escape/secret.json"); status != http.StatusForbidden {
		t.Fatalf("junction escape status = %d, want %d", status, http.StatusForbidden)
	}
	if _, status = resolveAppearanceFilePath(filepath.Join(linked, "missing"), "langs/en.json"); status != http.StatusNotFound {
		t.Fatalf("missing root status = %d, want %d", status, http.StatusNotFound)
	}
}

func createAppearanceTestJunction(t *testing.T, link, target string) {
	t.Helper()
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("create junction %q -> %q: %v, %s", link, target, err, output)
	}
}
