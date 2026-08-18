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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestMigrateLegacyIOSWorkspaceSkipsAndroid(t *testing.T) {
	setMobileMigrationContainer(t, ContainerAndroid)
	workspaceBaseDir := prepareLegacyMobileWorkspace(t)
	siblingWorkspace := filepath.Join(workspaceBaseDir, "Todo")
	if err := os.MkdirAll(siblingWorkspace, 0755); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateLegacyIOSWorkspace(workspaceBaseDir)
	if err != nil {
		t.Fatalf("migrateLegacyIOSWorkspace() returned an error: %s", err)
	}
	if migrated {
		t.Fatal("Android workspace must not run the legacy iOS migration")
	}
	for _, path := range []string{filepath.Join(workspaceBaseDir, "conf"), filepath.Join(workspaceBaseDir, "data"),
		filepath.Join(workspaceBaseDir, "temp"), siblingWorkspace} {
		if _, err = os.Stat(path); err != nil {
			t.Fatalf("source path [%s] must remain unchanged: %s", path, err)
		}
	}
}

func TestMigrateLegacyIOSWorkspaceMovesKnownEntries(t *testing.T) {
	setMobileMigrationContainer(t, ContainerIOS)
	workspaceBaseDir := prepareLegacyMobileWorkspace(t)
	for _, name := range []string{"repo", "history", "corrupted", "sync", "backup"} {
		writeMigrationMarker(t, filepath.Join(workspaceBaseDir, name))
	}
	siblingWorkspace := filepath.Join(workspaceBaseDir, "Todo")
	writeMigrationMarker(t, siblingWorkspace)

	migrated, err := migrateLegacyIOSWorkspace(workspaceBaseDir)
	if err != nil {
		t.Fatalf("migrateLegacyIOSWorkspace() returned an error: %s", err)
	}
	if !migrated {
		t.Fatal("legacy iOS workspace should be migrated")
	}
	for _, name := range legacyIOSWorkspaceEntries {
		from := filepath.Join(workspaceBaseDir, name)
		if _, err = os.Stat(from); !os.IsNotExist(err) {
			t.Fatalf("source path [%s] should be moved", from)
		}
		marker := filepath.Join(workspaceBaseDir, "siyuan", name, "marker")
		if _, err = os.Stat(marker); err != nil {
			t.Fatalf("migration marker [%s] is missing: %s", marker, err)
		}
	}
	if _, err = os.Stat(filepath.Join(siblingWorkspace, "marker")); err != nil {
		t.Fatalf("sibling workspace must not be moved: %s", err)
	}

	migrated, err = migrateLegacyIOSWorkspace(workspaceBaseDir)
	if err != nil {
		t.Fatalf("repeated migrateLegacyIOSWorkspace() returned an error: %s", err)
	}
	if migrated {
		t.Fatal("repeated migration should be a no-op")
	}
}

func TestMigrateLegacyIOSWorkspaceRejectsDestinationConflicts(t *testing.T) {
	setMobileMigrationContainer(t, ContainerIOS)
	workspaceBaseDir := prepareLegacyMobileWorkspace(t)
	writeMigrationMarker(t, filepath.Join(workspaceBaseDir, "sync"))
	destinationData := filepath.Join(workspaceBaseDir, "siyuan", "data")
	writeMigrationMarker(t, destinationData)

	migrated, err := migrateLegacyIOSWorkspace(workspaceBaseDir)
	if err == nil {
		t.Fatal("destination conflict should abort migration")
	}
	if migrated {
		t.Fatal("conflicting migration must not be reported as successful")
	}
	for _, name := range []string{"conf", "data", "temp", "sync"} {
		marker := filepath.Join(workspaceBaseDir, name, "marker")
		if _, statErr := os.Stat(marker); statErr != nil {
			t.Fatalf("source marker [%s] must remain after preflight failure: %s", marker, statErr)
		}
	}
	if _, err = os.Stat(filepath.Join(destinationData, "marker")); err != nil {
		t.Fatalf("destination data must remain unchanged: %s", err)
	}
}

func TestReplaceLegacyIOSWorkspacePath(t *testing.T) {
	workspaceBaseDir := filepath.Join(t.TempDir(), "Documents")
	defaultWorkspaceDir := filepath.Join(workspaceBaseDir, "siyuan")
	otherWorkspaceDir := filepath.Join(workspaceBaseDir, "Todo")
	paths := []string{workspaceBaseDir, otherWorkspaceDir, workspaceBaseDir + string(os.PathSeparator)}
	want := []string{defaultWorkspaceDir, otherWorkspaceDir}

	if got := replaceLegacyIOSWorkspacePath(paths, workspaceBaseDir, defaultWorkspaceDir); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected workspace paths: got %v, want %v", got, want)
	}
}

func TestIsMobileWorkspaceBaseDir(t *testing.T) {
	originalContainer, originalHomeDir := Container, HomeDir
	workspaceBaseDir := filepath.Join(t.TempDir(), "files")
	Container = ContainerAndroid
	HomeDir = filepath.Join(workspaceBaseDir, "home")
	t.Cleanup(func() {
		Container, HomeDir = originalContainer, originalHomeDir
	})

	for _, path := range []string{workspaceBaseDir, workspaceBaseDir + string(os.PathSeparator),
		filepath.Join(workspaceBaseDir, ".")} {
		if !IsMobileWorkspaceBaseDir(path) {
			t.Fatalf("mobile workspace base dir [%s] should be reserved", path)
		}
	}
	for _, path := range []string{filepath.Dir(workspaceBaseDir), filepath.Join(workspaceBaseDir, "siyuan")} {
		if IsMobileWorkspaceBaseDir(path) {
			t.Fatalf("path [%s] should not be treated as the mobile workspace base dir", path)
		}
	}

	Container = ContainerStd
	if IsMobileWorkspaceBaseDir(workspaceBaseDir) {
		t.Fatal("desktop paths must not be treated as the mobile workspace base dir")
	}
}

func prepareLegacyMobileWorkspace(t *testing.T) string {
	t.Helper()
	workspaceBaseDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspaceBaseDir, "siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"conf", "data", "temp"} {
		writeMigrationMarker(t, filepath.Join(workspaceBaseDir, name))
	}
	return workspaceBaseDir
}

func writeMigrationMarker(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "marker"), []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
}

func setMobileMigrationContainer(t *testing.T, container string) {
	t.Helper()
	originalContainer := Container
	Container = container
	t.Cleanup(func() {
		Container = originalContainer
	})
}
