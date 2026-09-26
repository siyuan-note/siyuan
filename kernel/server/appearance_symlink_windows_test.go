//go:build windows

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

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
