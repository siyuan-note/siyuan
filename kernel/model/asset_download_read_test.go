// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDeferredAssetPathWithoutLocalDirectories(t *testing.T) {
	originalDataDir, originalWorkspaceDir, originalConf := util.DataDir, util.WorkspaceDir, Conf
	t.Cleanup(func() { util.DataDir, util.WorkspaceDir, Conf = originalDataDir, originalWorkspaceDir, originalConf })
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	Conf = NewAppConf()
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	const boxID = "20260905010101-abcdefg"
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(boxConfPath, []byte(`{"name":"Notebook"}`), 0644); err != nil {
		t.Fatal(err)
	}
	files := []*entity.File{
		{Path: "/assets/site/index.html"},
		{Path: "/" + boxID + "/assets/notebook.pdf"},
		{Path: "/" + boxID + "/20260905010102-abcdefg/assets/document.pdf"},
	}
	for _, test := range []struct {
		assetPath string
		boxID     string
		wantPath  string
	}{
		{"assets/site/index.html", "", "assets/site/index.html"},
		{"assets/site", "", "assets/site"},
		{"assets/site/", "", "assets/site"},
		{"assets/notebook.pdf", boxID, boxID + "/assets/notebook.pdf"},
		{"assets/document.pdf", "", boxID + "/20260905010102-abcdefg/assets/document.pdf"},
	} {
		t.Run(test.assetPath, func(t *testing.T) {
			got, err := deferredAssetPathFromFiles(test.assetPath, test.boxID, false, files)
			want := filepath.Join(util.DataDir, filepath.FromSlash(test.wantPath))
			if err != nil || got != want {
				t.Fatalf("got %q, %v; want %q", got, err, want)
			}
			if _, statErr := os.Stat(got); !os.IsNotExist(statErr) {
				t.Fatalf("metadata resolution created local content: %v", statErr)
			}
		})
	}
	if got, err := deferredAssetPathFromFiles("assets/unknown.pdf", "", false, files); err != nil || got != "" {
		t.Fatalf("unknown asset resolved: %q, %v", got, err)
	}
}

func TestDeferredAssetReadAndDirectoryExport(t *testing.T) {
	originalConf := Conf
	originalWorkspace, originalData, originalRepo := util.WorkspaceDir, util.DataDir, util.RepoDir
	originalHistory, originalTemp, originalConfDir := util.HistoryDir, util.TempDir, util.ConfDir
	originalStatusBar := util.StatusBarCfg
	t.Cleanup(func() {
		Conf = originalConf
		util.WorkspaceDir, util.DataDir, util.RepoDir = originalWorkspace, originalData, originalRepo
		util.HistoryDir, util.TempDir, util.ConfDir = originalHistory, originalTemp, originalConfDir
		util.StatusBarCfg = originalStatusBar
	})
	base := t.TempDir()
	remote := filepath.Join(base, "cloud")
	key := []byte("0123456789abcdef0123456789abcdef")
	fullDir := filepath.Join(base, "full")
	backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: filepath.Join(fullDir, "repo"),
		AvailableSize: 1024 * 1024 * 1024, Local: &cloud.ConfLocal{Endpoint: remote}}})
	full, err := dejavu.NewRepo(filepath.Join(fullDir, "data"), filepath.Join(fullDir, "repo"),
		filepath.Join(fullDir, "history"), filepath.Join(fullDir, "temp"), "full", "full", "windows", key, nil, backend)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"seed.txt": "seed", "assets/image.png": "image bytes",
		"assets/site/index.html": "<p>site</p>", "assets/site/style.css": "p { color: red; }",
	}
	for name, data := range files {
		absPath := filepath.Join(fullDir, "data", filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(absPath, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	util.StatusBarCfg = &util.StatusBar{MsgDataSyncDisabled: true}
	Conf.Sync, Conf.Repo, Conf.System, Conf.Search = conf.NewSync(), conf.NewRepo(), conf.NewSystem(), conf.NewSearch()
	Conf.FileTree = conf.NewFileTree()
	Conf.Sync.Local = &conf.Local{Endpoint: remote}
	Conf.User = &conf.User{UserId: "asset-test", UserSiYuanOneTimePayStatus: 1}
	Conf.Sync.Provider, Conf.Sync.CloudName, Conf.Sync.Enabled = conf.ProviderLocal, "main", true
	Conf.Sync.Local.Endpoint, Conf.Sync.AssetDownloadMode = remote, 1
	Conf.Repo.Key = key
	util.WorkspaceDir = filepath.Join(base, "partial")
	util.DataDir, util.RepoDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "repo")
	util.HistoryDir, util.TempDir = filepath.Join(util.WorkspaceDir, "history"), filepath.Join(util.WorkspaceDir, "temp")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	if err = os.MkdirAll(util.RepoDir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = full.Index("full", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	partial, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "seed.txt"), []byte("seed"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = partial.Index("partial", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "assets", "image.png")); !os.IsNotExist(err) {
		t.Fatalf("asset was eagerly downloaded: %v", err)
	}
	if assets := SearchAssetsByName("image", nil); len(assets) != 1 || assets[0].Path != "assets/image.png" {
		t.Fatalf("deferred asset missing from name search: %+v", assets)
	}
	data, err := ReadAssetBytesInBox("", "assets/image.png")
	if err != nil || !bytes.Equal(data, []byte("image bytes")) {
		t.Fatalf("on-demand read: %q, %v", data, err)
	}
	Conf.Sync.Enabled = false
	if _, err = ReadAssetBytesInBox("", "assets/image.png"); err != nil {
		t.Fatalf("cached asset unavailable with sync disabled: %v", err)
	}
	if uri, exportErr := ExportResources([]string{"data/assets/site"}, "site"); exportErr == nil || uri != "" {
		t.Fatalf("offline incomplete directory export succeeded: %q, %v", uri, exportErr)
	}
	Conf.Sync.Enabled = true
	uri, err := ExportResources([]string{"data/assets/site"}, "site")
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.OpenReader(filepath.Join(util.WorkspaceDir, filepath.FromSlash(uri)))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	entries := map[string]bool{}
	for _, entry := range archive.File {
		entries[filepath.Base(entry.Name)] = true
	}
	if !entries["index.html"] || !entries["style.css"] {
		t.Fatalf("directory export omitted deferred files: %+v", entries)
	}
	deferred, err := DeferredSyncAssets()
	if err != nil || len(deferred) != 0 {
		t.Fatalf("downloaded files stayed deferred: %+v, %v", deferred, err)
	}
	if !strings.HasPrefix(uri, "temp/export/") {
		t.Fatalf("unexpected export path: %q", uri)
	}
}

func TestDeferredAssetPathRejectsMissingLeafThroughEscapingSymlink(t *testing.T) {
	originalDataDir := util.DataDir
	t.Cleanup(func() { util.DataDir = originalDataDir })
	util.DataDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(util.DataDir, "assets", "linked")); err != nil {
		t.Skipf("symlink unavailable: %s", err)
	}
	files := []*entity.File{{Path: "/assets/linked/missing/image.png"}}
	if got, err := deferredAssetPathFromFiles("assets/linked/missing/image.png", "", false, files); err == nil {
		t.Fatalf("escaped missing asset resolved: %q", got)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "not-created"), filepath.Join(util.DataDir, "assets", "dangling")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveDataAssetPath("assets/dangling/missing.png"); err == nil {
		t.Fatal("dangling symlink must not become a writable deferred path")
	}
}
