// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func createAssetTestJunction(t *testing.T, junction, target string) {
	t.Helper()
	output, err := exec.Command("cmd", "/d", "/c", "mklink", "/J", junction, target).CombinedOutput()
	if err != nil {
		t.Fatalf("create directory junction [%s] to [%s] failed: %s: %s", junction, target, err, output)
	}
	t.Cleanup(func() {
		if removeErr := os.Remove(junction); removeErr != nil && !os.IsNotExist(removeErr) {
			t.Errorf("remove directory junction [%s] failed: %s", junction, removeErr)
		}
	})
}

func TestIsValidResolvedAssetPathWithJunctionedWorkspace(t *testing.T) {
	originalDataDir, originalWorkspaceDir := util.DataDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.WorkspaceDir = originalDataDir, originalWorkspaceDir
	})

	realWorkspaceDir := t.TempDir()
	aliasWorkspaceDir := filepath.Join(t.TempDir(), "workspace")
	createAssetTestJunction(t, aliasWorkspaceDir, realWorkspaceDir)
	util.WorkspaceDir = aliasWorkspaceDir
	util.DataDir = filepath.Join(aliasWorkspaceDir, "data")

	assetPath := filepath.Join(util.DataDir, "assets", "image.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}

	resolvedPath, err := model.GetAssetAbsPath("assets/image.png")
	if err != nil {
		t.Fatal(err)
	}
	if !isValidResolvedAssetPath(resolvedPath, "") {
		t.Fatalf("asset [%s] under junctioned workspace should be valid", resolvedPath)
	}

	const (
		boxID = "20260813000000-box0001"
		docID = "20260813000001-doc0001"
	)
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err = os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(boxConfPath, []byte(`{"name":"Notebook"}`), 0644); err != nil {
		t.Fatal(err)
	}
	documentAssetPath := filepath.Join(util.DataDir, boxID, docID, "assets", "document.png")
	if err = os.MkdirAll(filepath.Dir(documentAssetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(documentAssetPath, []byte("document image"), 0644); err != nil {
		t.Fatal(err)
	}

	if !isValidResolvedAssetPath(documentAssetPath, "") {
		t.Fatalf("document asset [%s] under junctioned workspace should be valid", documentAssetPath)
	}
}

func TestIsValidResolvedAssetPathRejectsEscapingJunction(t *testing.T) {
	originalDataDir, originalWorkspaceDir := util.DataDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.WorkspaceDir = originalDataDir, originalWorkspaceDir
	})

	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}

	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.png")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	linkedDir := filepath.Join(assetsDir, "linked")
	createAssetTestJunction(t, linkedDir, outsideDir)

	resolvedPath, err := model.GetAssetAbsPath("assets/linked/outside.png")
	if err != nil {
		t.Fatal(err)
	}
	if isValidResolvedAssetPath(resolvedPath, "") {
		t.Fatalf("asset junction escaping assets directory should be rejected: %s", resolvedPath)
	}
}
