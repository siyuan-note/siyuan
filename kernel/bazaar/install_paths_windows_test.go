// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func makeInstallJunction(t *testing.T, link, target string) {
	t.Helper()
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("create junction: %v: %s", err, output)
	}
}

func TestInstallPathsAllowWorkspaceJunctions(t *testing.T) {
	for _, workspaceIsJunction := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[workspaceIsJunction], func(t *testing.T) {
			oldWorkspace, oldConf, oldData, oldTemp := util.WorkspaceDir, util.ConfDir, util.DataDir, util.TempDir
			t.Cleanup(func() {
				util.WorkspaceDir, util.ConfDir, util.DataDir, util.TempDir = oldWorkspace, oldConf, oldData, oldTemp
			})
			root := t.TempDir()
			realRoot, alias := filepath.Join(root, "real"), filepath.Join(root, "alias")
			if err := os.Mkdir(realRoot, 0755); err != nil {
				t.Fatal(err)
			}
			makeInstallJunction(t, alias, realRoot)
			util.WorkspaceDir = alias
			if !workspaceIsJunction {
				util.WorkspaceDir = filepath.Join(alias, "workspace")
			}
			if err := os.MkdirAll(util.WorkspaceDir, 0755); err != nil {
				t.Fatal(err)
			}
			util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
			util.DataDir = filepath.Join(util.WorkspaceDir, "data")
			util.TempDir = filepath.Join(util.WorkspaceDir, "temp")
			for _, kind := range []string{"local", "package"} {
				if _, err := makePackageExtractionDir(kind, "extract-"); err != nil {
					t.Fatalf("extract %s under workspace junction: %v", kind, err)
				}
			}
			source := filepath.Join(realRoot, "source")
			if err := os.Mkdir(source, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source, "index.js"), []byte("new"), 0644); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"plugins", "themes", "icons", "templates", "widgets"} {
				target := filepath.Join(util.DataDir, kind, "sample")
				if err := replacePackageDirectory(source, target, false); err != nil {
					t.Fatalf("install %s: %v", kind, err)
				}
				if revision, err := InstalledPackageRevision(target); err != nil || !validInstallHash(revision) {
					t.Fatalf("read %s revision: %s, %v", kind, revision, err)
				}
				if err := replacePackageDirectory(source, target, true); err != nil {
					t.Fatalf("update %s: %v", kind, err)
				}
			}
		})
	}
}

func TestPackageExtractionRejectsJunctionsInsideWorkspace(t *testing.T) {
	for _, relative := range []string{"temp", "temp/bazaar", "temp/bazaar/local", "temp/bazaar/package"} {
		t.Run(relative, func(t *testing.T) {
			oldWorkspace, oldTemp := util.WorkspaceDir, util.TempDir
			t.Cleanup(func() { util.WorkspaceDir, util.TempDir = oldWorkspace, oldTemp })
			util.WorkspaceDir = t.TempDir()
			util.TempDir = filepath.Join(util.WorkspaceDir, "temp")
			outside := t.TempDir()
			link := filepath.Join(util.WorkspaceDir, filepath.FromSlash(relative))
			if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
				t.Fatal(err)
			}
			makeInstallJunction(t, link, outside)
			kind := "local"
			if filepath.Base(link) == "package" {
				kind = "package"
			}
			if _, err := makePackageExtractionDir(kind, "extract-"); err == nil {
				t.Fatal("extraction followed an internal junction")
			}
			if entries, err := os.ReadDir(outside); err != nil || len(entries) != 0 {
				t.Fatalf("extraction wrote through a junction: %v, %v", entries, err)
			}
		})
	}
}

func TestInstallPathsRejectJunctionsInsideWorkspace(t *testing.T) {
	oldWorkspace := util.WorkspaceDir
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	util.WorkspaceDir = t.TempDir()
	outside := t.TempDir()
	for _, relative := range []string{"data/plugins", "conf/plugin-development", "data/themes/sample"} {
		link := filepath.Join(util.WorkspaceDir, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
			t.Fatal(err)
		}
		makeInstallJunction(t, link, outside)
		for _, target := range []string{link, filepath.Join(link, "missing")} {
			if err := rejectInstallPathLinks(target); err == nil {
				t.Fatalf("accepted internal junction: %s", target)
			}
		}
	}
}
