// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPluginSnapshotScope(t *testing.T) {
	for _, name := range []string{"", ".", "..", "../outside", "a/b", `a\b`, "C:", "CON", "name."} {
		if _, err := pluginSnapshotRoots(name); err == nil {
			t.Fatalf("accepted invalid name %q", name)
		}
	}
	if _, err := pluginSnapshotRoots("siyuan-plugin-example"); err != nil {
		t.Fatal(err)
	}
}

func TestPluginSnapshotRestoreAndBackup(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	write := func(name, content string) {
		t.Helper()
		p := filepath.Join(util.DataDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("plugins/example/index.js", "old program")
	write("plugins/example/plugin.json", `{"name":"example","version":"1.0.0"}`)
	write("storage/petal/example/data.json", "old data")
	write("storage/petal/example-other/keep.json", "unrelated")
	id, _, err := CreateRepoSnapshotWithFullCheck("plugin version", true)
	if err != nil {
		t.Fatal(err)
	}
	write("plugins/example/index.js", "new program")
	write("storage/petal/example/data.json", "new data")
	write("storage/petal/example/extra.json", "extra")
	listed, err := GetPluginSnapshots("example", 1)
	if err != nil || listed.TotalCount != 1 || listed.Snapshots[0].Program.Count != 2 || listed.Snapshots[0].Data.Count != 1 {
		t.Fatalf("plugin metadata: %+v %v", listed, err)
	}
	backup, err := RestorePluginSnapshot("example", id)
	if err != nil || backup == "" || backup == id {
		t.Fatalf("restore: backup=%s err=%v", backup, err)
	}
	for name, want := range map[string]string{
		"plugins/example/index.js": "old program", "storage/petal/example/data.json": "old data",
		"storage/petal/example-other/keep.json": "unrelated",
	} {
		data, err := os.ReadFile(filepath.Join(util.DataDir, filepath.FromSlash(name)))
		if err != nil || string(data) != want {
			t.Fatalf("%s: %q %v", name, data, err)
		}
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "storage/petal/example/extra.json")); !os.IsNotExist(err) {
		t.Fatalf("extra file retained: %v", err)
	}
	index, err := repo.GetIndex(backup)
	if err != nil {
		t.Fatal(err)
	}
	roots, _ := pluginSnapshotRoots("example")
	files, counts, err := pluginSnapshotFiles(repo, index, roots)
	if err != nil || counts[1].Count != 2 {
		t.Fatalf("backup incomplete: %+v %v", counts, err)
	}
	for _, file := range files {
		if file.Path == "/plugins/example/index.js" {
			data, err := repo.OpenFile(file)
			if err != nil || string(data) != "new program" {
				t.Fatalf("backup content: %q %v", data, err)
			}
		}
	}
	if petal := getPetalByName("example", getPetals0()); petal == nil || petal.Enabled {
		t.Fatal("restored plugin must stay disabled")
	}
	original, err := repo.GetIndex(id)
	if err != nil {
		t.Fatal(err)
	}
	files, _, err = pluginSnapshotFiles(repo, original, roots)
	if err != nil {
		t.Fatal(err)
	}
	store, err := dejavu.NewStore(util.RepoDir, Conf.Repo.Load().Key)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if file.Path == "/plugins/example/index.js" {
			_, chunkPath := store.AbsPath(file.Chunks[0])
			if err = os.WriteFile(chunkPath, []byte("corrupt ciphertext"), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	write("plugins/example/index.js", "current after restore")
	if _, err = RestorePluginSnapshot("example", id); err == nil {
		t.Fatal("corrupt source accepted")
	}
	if data, err := os.ReadFile(filepath.Join(util.DataDir, "plugins/example/index.js")); err != nil || string(data) != "current after restore" {
		t.Fatalf("authentication failure changed current files: %q %v", data, err)
	}
}

func TestPluginSnapshotInstallCompensatesBothDirectories(t *testing.T) {
	previous := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() { util.DataDir = previous })
	roots, _ := pluginSnapshotRoots("example")
	stage := t.TempDir()
	for _, root := range roots {
		for _, pair := range [][2]string{{util.DataDir, "before"}, {filepath.Join(stage, "install"), "after"}} {
			p := filepath.Join(pair[0], root, "file")
			if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, []byte(pair[1]), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	injected := errors.New("failed second install")
	calls := 0
	err := installPluginSnapshot(stage, roots, func(from, to string) error {
		calls++
		if calls == 4 {
			return injected
		}
		return os.Rename(from, to)
	})
	if !errors.Is(err, injected) {
		t.Fatalf("unexpected failure: %v", err)
	}
	for _, root := range roots {
		data, err := os.ReadFile(filepath.Join(util.DataDir, root, "file"))
		if err != nil || string(data) != "before" {
			t.Fatalf("compensation lost %s: %q %v", root, data, err)
		}
	}
}
