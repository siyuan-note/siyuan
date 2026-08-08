// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWorkspacePathContainment(t *testing.T) {
	workspace := t.TempDir()
	inside := filepath.Join(workspace, "inside")
	outside := t.TempDir()
	if err := os.Mkdir(inside, 0755); err != nil {
		t.Fatal(err)
	}

	if _, err := newWorkspacePathGuard(workspace, filepath.Join("..", filepath.Base(outside))); !errors.Is(err, errWorkspacePathOutside) {
		t.Fatalf("lexical escape returned %v", err)
	}

	escapeLink := filepath.Join(workspace, "escape")
	if createTestSymlink(t, outside, escapeLink) {
		if _, err := newWorkspacePathGuard(workspace, "escape"); !errors.Is(err, errWorkspacePathOutside) {
			t.Fatalf("physical escape returned %v", err)
		}
	}

	insideLink := filepath.Join(workspace, "inside-link")
	if createTestSymlink(t, inside, insideLink) {
		guard, err := newWorkspacePathGuard(workspace, "inside-link")
		if err != nil {
			t.Fatalf("contained link was rejected: %v", err)
		}
		if !guard.requestedInfo.IsDir() {
			t.Fatal("contained directory link did not resolve to a directory")
		}
	}
}

func TestWorkspacePathDetectsRootReplacement(t *testing.T) {
	parent := t.TempDir()
	workspace := filepath.Join(parent, "workspace")
	requested := filepath.Join(workspace, "requested")
	if err := os.MkdirAll(requested, 0755); err != nil {
		t.Fatal(err)
	}
	guard, err := newWorkspacePathGuard(workspace, "requested")
	if err != nil {
		t.Fatal(err)
	}

	moved := filepath.Join(parent, "workspace-moved")
	if err = os.Rename(workspace, moved); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(requested, 0755); err != nil {
		t.Fatal(err)
	}
	if err = guard.revalidate(); !errors.Is(err, errWorkspacePathChanged) {
		t.Fatalf("root replacement returned %v", err)
	}
}

func TestWorkspacePathDetectsParentRedirect(t *testing.T) {
	workspace := t.TempDir()
	parent := filepath.Join(workspace, "parent")
	requested := filepath.Join(parent, "requested")
	if err := os.MkdirAll(requested, 0755); err != nil {
		t.Fatal(err)
	}
	guard, err := newWorkspacePathGuard(workspace, filepath.Join("parent", "requested"))
	if err != nil {
		t.Fatal(err)
	}

	moved := filepath.Join(workspace, "parent-moved")
	if err = os.Rename(parent, moved); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err = os.Mkdir(filepath.Join(outside, "requested"), 0755); err != nil {
		t.Fatal(err)
	}
	if !createTestSymlink(t, outside, parent) {
		if runtime.GOOS != "windows" {
			return
		}
		createTestJunction(t, outside, parent)
	}
	if err = guard.revalidate(); !errors.Is(err, errWorkspacePathChanged) {
		t.Fatalf("parent redirect returned %v", err)
	}
}

func TestWorkspacePathRootIdentity(t *testing.T) {
	workspace := t.TempDir()
	guard, err := newWorkspacePathGuard(workspace, "")
	if err != nil {
		t.Fatal(err)
	}
	root, err := guard.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	info, err := root.Stat(".")
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(info, guard.workspaceInfo) {
		t.Fatal("root is not anchored to the validated workspace")
	}
}

func TestWorkspacePathCanonicalComparison(t *testing.T) {
	if got := canonicalWorkspacePathForOS(filepath.Join("Root", "Tree"), "windows"); got != filepath.Join("root", "tree") {
		t.Fatalf("windows canonical path = %q", got)
	}
	windowsRelative, windowsContained := workspaceRelativePathForOS(
		filepath.Join(string(filepath.Separator), "Root"),
		filepath.Join(string(filepath.Separator), "root", "MiXeD"),
		"windows",
	)
	if !windowsContained || windowsRelative != "MiXeD" {
		t.Fatalf("windows original-case relative path = %q, contained=%t", windowsRelative, windowsContained)
	}

	for _, goos := range []string{"darwin", "linux"} {
		if got := canonicalWorkspacePathForOS(filepath.Join("Root", "Tree"), goos); got != filepath.Join("Root", "Tree") {
			t.Fatalf("%s canonical path = %q", goos, got)
		}
		relative, contained := workspaceRelativePathForOS(
			filepath.Join(string(filepath.Separator), "Root"),
			filepath.Join(string(filepath.Separator), "Root", "MiXeD"),
			goos,
		)
		if !contained || relative != "MiXeD" {
			t.Fatalf("%s original-case relative path = %q, contained=%t", goos, relative, contained)
		}
	}

	if runtime.GOOS != "windows" {
		if relative, contained := workspaceRelativePathForOS(
			filepath.Join(string(filepath.Separator), "Root"),
			filepath.Join(string(filepath.Separator), "root", "MiXeD"),
			"darwin",
		); contained || relative != "" {
			t.Fatalf("Darwin case-distinct sibling root relative path = %q, contained=%t", relative, contained)
		}
	}
}

func TestWorkspacePathPreservesRequestedCaseForAccess(t *testing.T) {
	workspace := t.TempDir()
	mixedCaseName := "MiXeD"
	mixedCasePath := filepath.Join(workspace, mixedCaseName)
	if err := os.Mkdir(mixedCasePath, 0755); err != nil {
		t.Fatal(err)
	}

	guard, err := newWorkspacePathGuard(workspace, mixedCaseName)
	if err != nil {
		t.Fatal(err)
	}
	if guard.relativePath != mixedCaseName {
		t.Fatalf("relative path = %q, want %q", guard.relativePath, mixedCaseName)
	}
	root, err := guard.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	opened, err := root.Open(guard.relativePath)
	if err != nil {
		t.Fatalf("open original-case relative path: %v", err)
	}
	opened.Close()

	if runtime.GOOS == "darwin" {
		lowerCasePath := filepath.Join(workspace, "mixed")
		if err = os.Mkdir(lowerCasePath, 0755); err == nil {
			lowerGuard, guardErr := newWorkspacePathGuard(workspace, "mixed")
			if guardErr != nil {
				t.Fatalf("case-sensitive volume lowercase access failed: %v", guardErr)
			}
			if lowerGuard.relativePath != "mixed" {
				t.Fatalf("case-sensitive volume relative path = %q", lowerGuard.relativePath)
			}
		} else if !os.IsExist(err) {
			t.Fatalf("probe Darwin volume case sensitivity: %v", err)
		}
	}
}

func TestWorkspacePathWindowsReparseHandling(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows reparse-point test")
	}
	workspace := t.TempDir()
	inside := filepath.Join(workspace, "inside")
	if err := os.Mkdir(inside, 0755); err != nil {
		t.Fatal(err)
	}
	insideJunction := filepath.Join(workspace, "inside-junction")
	createTestJunction(t, inside, insideJunction)
	guard, err := newWorkspacePathGuard(workspace, "inside-junction")
	if err != nil {
		t.Fatalf("contained junction validation failed: %v", err)
	}
	if !guard.unsupportedReparse {
		t.Fatal("contained junction was not classified as an unsupported reparse point")
	}

	outside := t.TempDir()
	outsideJunction := filepath.Join(workspace, "outside-junction")
	createTestJunction(t, outside, outsideJunction)
	if _, err = newWorkspacePathGuard(workspace, "outside-junction"); !errors.Is(err, errWorkspacePathOutside) {
		t.Fatalf("outside junction returned %v", err)
	}
}

func TestWorkspacePathWindowsCrossVolumeJunction(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows cross-volume junction test")
	}
	workspaceBase := windowsTempDir(t, os.Getenv("LOCALAPPDATA"))
	workspace := filepath.Join(workspaceBase, "workspace")
	if err := os.Mkdir(workspace, 0755); err != nil {
		t.Fatal(err)
	}
	target := windowsCrossVolumeTempDir(t, `D:\`)
	junction := filepath.Join(workspace, "cross-volume")
	createTestJunction(t, target, junction)
	if _, err := newWorkspacePathGuard(workspace, "cross-volume"); !errors.Is(err, errWorkspacePathOutside) {
		t.Fatalf("cross-volume junction returned %v", err)
	}
}

func windowsTempDir(t *testing.T, parent string) string {
	t.Helper()
	if parent == "" {
		t.Fatal("Windows temporary parent is unavailable")
	}
	path, err := os.MkdirTemp(parent, "siyuan-pr01-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(path) })
	return path
}

func windowsCrossVolumeTempDir(t *testing.T, parent string) string {
	t.Helper()
	if _, err := os.Stat(parent); os.IsNotExist(err) {
		t.Skipf("Windows cross-volume parent %s is unavailable", parent)
	} else if err != nil {
		t.Fatalf("inspect Windows cross-volume parent %s: %v", parent, err)
	}
	return windowsTempDir(t, parent)
}

func createTestSymlink(t *testing.T, target, link string) bool {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Logf("symlink privilege unavailable: %v", err)
			return false
		}
		t.Fatal(err)
	}
	return true
}

func createTestJunction(t *testing.T, target, link string) {
	t.Helper()
	output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput()
	if err != nil {
		t.Fatalf("create junction failed: %v: %s", err, output)
	}
}

func createTestRelativeDirectorySymlink(t *testing.T, target, link string) bool {
	t.Helper()
	output, err := exec.Command("cmd", "/c", "mklink", "/D", link, target).CombinedOutput()
	if err != nil {
		t.Logf("directory symlink privilege unavailable: %v: %s", err, output)
		return false
	}
	return true
}
