// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPromoteAssetsPreservesConflictingFiles(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	write := func(filename, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	read := func(filename, want string) {
		t.Helper()
		if data, err := os.ReadFile(filename); err != nil || string(data) != want {
			t.Fatalf("asset changed: %s = %q, %v", filename, data, err)
		}
	}
	boxDir := filepath.Join(util.DataDir, "20261026000000-box0001")
	global := filepath.Join(util.DataDir, "assets", "sub", "report.pdf")
	local := filepath.Join(boxDir, "assets", "sub", "report.pdf")
	write(global, "global version")
	write(local, "local version!")
	if err := copyBoxAssetsToDataAssets(filepath.Base(boxDir)); err == nil {
		t.Fatal("conflicting copy succeeded")
	}
	read(global, "global version")
	read(local, "local version!")
	write(local, "global version")
	if err := copyBoxAssetsToDataAssets(filepath.Base(boxDir)); err != nil {
		t.Fatal(err)
	}
	read(global, "global version")
	other := filepath.Join(boxDir, "20261026000000-parent1", "assets", "sub", "report.pdf")
	write(other, "another version")
	if err := copyBoxAssetsToDataAssets(filepath.Base(boxDir)); err == nil {
		t.Fatal("conflict between multiple local directories succeeded")
	}
	read(global, "global version")
	read(other, "another version")
	if err := os.Remove(global); err != nil {
		t.Fatal(err)
	}
	if err := promoteAssetDirectory(filepath.Join(boxDir, "assets"), filepath.Join(util.DataDir, "assets")); err != nil {
		t.Fatal(err)
	}
	read(global, "global version")
	read(local, "global version")
	if err := os.Remove(global); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(global, 0755); err != nil {
		t.Fatal(err)
	}
	if err := promoteAssetDirectory(filepath.Join(boxDir, "assets"), filepath.Join(util.DataDir, "assets")); err == nil {
		t.Fatal("file/directory conflict succeeded")
	}
	read(local, "global version")
}

func TestRemoveDocStopsOnAssetConflict(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previousHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = previousHistory })
	document := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	before, err := os.ReadFile(document)
	if err != nil {
		t.Fatal(err)
	}
	for filename, content := range map[string]string{
		filepath.Join(util.DataDir, "assets", "report.pdf"):                 "global",
		filepath.Join(util.DataDir, fixture.box.ID, "assets", "report.pdf"): "local",
	} {
		if err = os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filename, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err == nil {
		t.Fatal("document deletion ignored an asset conflict")
	}
	if after, readErr := os.ReadFile(document); readErr != nil || !bytes.Equal(before, after) {
		t.Fatalf("conflict removed current document: %v", readErr)
	}
	if treenode.GetBlockTreeInBox(fixture.sourceID, fixture.box.ID) == nil {
		t.Fatal("conflict removed current block tree")
	}
}
