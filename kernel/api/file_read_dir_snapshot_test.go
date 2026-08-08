// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestReadDirMetadataReferenceIdentityAndType(t *testing.T) {
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directoryPath, "file"), []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directoryPath, "child"), 0755); err != nil {
		t.Fatal(err)
	}

	root, directory, _ := openSnapshotFixture(t, workspace, "directory")
	for _, name := range []string{"file", "child"} {
		reference, err := captureReadDirMetadataReference(directory, name)
		if errors.Is(err, errReadDirMetadataReferenceUnsupported) {
			t.Skip(err)
		}
		if err != nil {
			t.Fatalf("capture metadata reference for %s: %v", name, err)
		}
		pathInfo, statErr := root.Lstat(filepath.Join("directory", name))
		revalidateErr := reference.revalidateEntry()
		closeErr := reference.closeReference()
		if statErr != nil {
			t.Fatalf("stat metadata path for %s: %v", name, statErr)
		}
		if revalidateErr != nil {
			t.Fatalf("revalidate metadata reference for %s: %v", name, revalidateErr)
		}
		if closeErr != nil {
			t.Fatalf("close metadata reference for %s: %v", name, closeErr)
		}
		if !sameReadDirEntryType(pathInfo, reference.info) || !reference.matches(pathInfo) {
			t.Fatalf("metadata reference for %s did not preserve entry identity and type", name)
		}
	}
}

func TestReadDirMetadataReferenceDoesNotFollowLink(t *testing.T) {
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directoryPath, "target")
	if err := os.WriteFile(target, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directoryPath, "link")
	if !createTestSymlink(t, "target", link) {
		t.Skip("symlink privilege unavailable")
	}

	_, directory, _ := openSnapshotFixture(t, workspace, "directory")
	reference, err := captureReadDirMetadataReference(directory, "link")
	if errors.Is(err, errReadDirMetadataReferenceUnsupported) {
		t.Skip(err)
	}
	if err != nil {
		t.Fatalf("capture no-follow metadata reference: %v", err)
	}
	defer reference.closeReference()
	linkInfo, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	targetInfo, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if !reference.matches(linkInfo) || reference.matches(targetInfo) {
		t.Fatal("metadata reference followed the symbolic link")
	}
	if err = reference.revalidateEntry(); err != nil {
		t.Fatalf("revalidate no-follow metadata reference: %v", err)
	}
}

func TestReadDirSnapshotOrderingAndMetadata(t *testing.T) {
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directoryPath, "A"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"b", "z"} {
		if err := os.WriteFile(filepath.Join(directoryPath, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	linkCreated := createTestSymlink(t, "b", filepath.Join(directoryPath, "m"))
	if !linkCreated {
		if err := os.WriteFile(filepath.Join(directoryPath, "m"), []byte("m"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
	snapshot, err := readDirSnapshot(root, directory, "directory", resolvedWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	wantNames := []string{"A", "b", "m", "z"}
	if len(snapshot) != len(wantNames) {
		t.Fatalf("snapshot length = %d", len(snapshot))
	}
	for i, want := range wantNames {
		if snapshot[i].name != want {
			t.Fatalf("snapshot[%d].name = %q, want %q", i, snapshot[i].name, want)
		}
		if snapshot[i].updated == 0 {
			t.Fatalf("snapshot[%d] has no update time", i)
		}
	}
	if !snapshot[0].isDir {
		t.Fatal("directory entry was not classified as a directory")
	}
	if snapshot[1].isDir || snapshot[3].isDir {
		t.Fatal("regular file was classified as a directory")
	}
	if snapshot[2].isSymlink != linkCreated {
		t.Fatalf("link classification = %t, want %t", snapshot[2].isSymlink, linkCreated)
	}
}

func TestReadDirSnapshotDetectsReplacementWithoutPartialResult(t *testing.T) {
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directoryPath, "A"), []byte("stable"), 0644); err != nil {
		t.Fatal(err)
	}
	victim := filepath.Join(directoryPath, "z")
	if err := os.WriteFile(victim, []byte("replace"), 0644); err != nil {
		t.Fatal(err)
	}

	root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
	replaced := false
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
			if err := os.Remove(victim); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(victim, 0755); err != nil {
				t.Fatal(err)
			}
		},
	}
	snapshot, err := snapshotter.read()
	if !errors.Is(err, errReadDirEntryChanged) {
		t.Fatalf("replacement returned %v", err)
	}
	if snapshot != nil {
		t.Fatalf("replacement returned partial snapshot: %#v", snapshot)
	}
}

func TestReadDirSnapshotRejectsEscapingLinkWithoutPartialResult(t *testing.T) {
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	if err := os.Mkdir(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directoryPath, "A"), []byte("stable"), 0644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	if !createTestSymlink(t, outside, filepath.Join(directoryPath, "z")) {
		t.Skip("symlink privilege unavailable")
	}

	root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
	snapshot, err := readDirSnapshot(root, directory, "directory", resolvedWorkspace)
	if !errors.Is(err, errWorkspacePathOutside) {
		t.Fatalf("escaping link returned %v", err)
	}
	if snapshot != nil {
		t.Fatalf("escaping link returned partial snapshot: %#v", snapshot)
	}
}

func TestReadDirSnapshotWindowsRejectsJunctionEntry(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows junction test")
	}
	workspace := t.TempDir()
	directoryPath := filepath.Join(workspace, "directory")
	target := filepath.Join(workspace, "target")
	if err := os.MkdirAll(directoryPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	createTestJunction(t, target, filepath.Join(directoryPath, "junction"))

	root, directory, resolvedWorkspace := openSnapshotFixture(t, workspace, "directory")
	metadataReference, err := captureReadDirMetadataReference(directory, "junction")
	if err != nil {
		t.Fatalf("capture junction metadata reference: %v", err)
	}
	junctionInfo, statErr := root.Lstat(filepath.Join("directory", "junction"))
	closeErr := metadataReference.closeReference()
	if statErr != nil {
		t.Fatalf("stat junction path: %v", statErr)
	}
	if closeErr != nil {
		t.Fatalf("close junction metadata reference: %v", closeErr)
	}
	if !sameReadDirEntryType(junctionInfo, metadataReference.info) || !metadataReference.matches(junctionInfo) {
		t.Fatal("junction metadata reference did not preserve reparse-point identity")
	}

	snapshot, err := readDirSnapshot(root, directory, "directory", resolvedWorkspace)
	if !errors.Is(err, errWorkspaceUnsupportedReparse) {
		t.Fatalf("junction entry returned %v", err)
	}
	if snapshot != nil {
		t.Fatalf("junction entry returned partial snapshot: %#v", snapshot)
	}
}

func openSnapshotFixture(t *testing.T, workspace, relative string) (*os.Root, *os.File, string) {
	t.Helper()
	resolvedWorkspace, err := resolveExistingWorkspacePath(workspace)
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(workspace)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	directory, err := root.Open(relative)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { directory.Close() })
	return root, directory, resolvedWorkspace
}
