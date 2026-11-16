// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type pluginProjectSizedFile struct {
	os.FileInfo
	bytes int64
}

func (f pluginProjectSizedFile) Size() int64 { return f.bytes }

func TestPluginProjectArtifactRetentionByteLimit(t *testing.T) {
	dir := t.TempDir()
	var entries []os.FileInfo
	for _, name := range []string{"current.zip", "old.zip", "recent.zip"} {
		file := filepath.Join(dir, name)
		if err := os.WriteFile(file, nil, 0600); err != nil {
			t.Fatal(err)
		}
		stamp := time.Unix(1, 0)
		if err := os.Chtimes(file, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(file)
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, pluginProjectSizedFile{info, 128 * 1024 * 1024})
	}
	expired := expiredPluginProjectArtifacts(entries, "current.zip")
	if len(expired) != 1 || expired[0].Name() != "old.zip" {
		t.Fatal("byte limit must retain current and newest archive", expired)
	}
	if expired = expiredPluginProjectArtifacts([]os.FileInfo{entries[0], entries[2]}, "current.zip"); len(expired) != 0 {
		t.Fatal("exact byte limit must be accepted")
	}
}

func TestPluginProjectArtifactRetentionPreservesFailedPublications(t *testing.T) {
	for _, failure := range []string{"delivery", "modified", "modified-delivery", "hardlink", "symlink"} {
		t.Run(failure, func(t *testing.T) {
			ctx, grant := pluginPackageProjectFixture(t)
			artifactsPath := filepath.Join(util.PluginProjectRoot(grant.TaskID), "artifacts")
			if err := os.MkdirAll(artifactsPath, 0700); err != nil {
				t.Fatal(err)
			}
			var oldest string
			for i := 0; i < 8; i++ {
				data := []byte{byte(i)}
				file := filepath.Join(artifactsPath, util.PluginProjectDigest(data)+".zip")
				if err := os.WriteFile(file, data, 0600); err != nil {
					t.Fatal(err)
				}
				stamp := time.Unix(int64(i+1), 0)
				if failure == "symlink" && i > 0 {
					stamp = time.Now().Add(time.Hour)
				}
				if err := os.Chtimes(file, stamp, stamp); err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					oldest = file
				}
			}
			status, err := util.GetPluginProjectStatus(ctx, grant.TaskID)
			if err != nil {
				t.Fatal(err)
			}
			switch failure {
			case "delivery":
				if err = os.MkdirAll(util.TempDir, 0700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(util.TempDir, "export"), []byte("unrelated"), 0600); err != nil {
					t.Fatal(err)
				}
			case "modified":
				if err = os.WriteFile(oldest, []byte("changed"), 0600); err != nil {
					t.Fatal(err)
				}
				stamp := time.Unix(1, 0)
				if err = os.Chtimes(oldest, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			case "modified-delivery":
				export := filepath.Join(util.TempDir, "export")
				if err = os.MkdirAll(export, 0700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(export, "plugin-project-"+grant.TaskID+"-"+filepath.Base(oldest)), []byte("changed"), 0600); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err = os.Link(oldest, filepath.Join(t.TempDir(), "external")); err != nil {
					t.Skip(err)
				}
			case "symlink":
				external := filepath.Join(t.TempDir(), "external")
				if err = os.Rename(oldest, external); err != nil {
					t.Fatal(err)
				}
				if err = os.Symlink(external, oldest); err != nil {
					t.Skip(err)
				}
			}
			artifact, err := PackagePluginProject(ctx, grant.TaskID, status.SourceRevision)
			if err == nil || artifact == nil {
				t.Fatal("expected retained new archive and explicit failure", err)
			}
			if _, err = os.Stat(filepath.Join(util.WorkspaceDir, artifact.PackagePath)); err != nil {
				t.Fatal("new archive lost", err)
			}
			if _, err = os.Lstat(oldest); err != nil {
				t.Fatal("recovery archive lost", err)
			}
			status, err = util.GetPluginProjectStatus(ctx, grant.TaskID)
			if err != nil {
				t.Fatal(err)
			}
			if (status.Artifact != nil) != (failure != "delivery") {
				t.Fatal("ready state does not match publication outcome")
			}
		})
	}
}

func TestPluginProjectArtifactRetentionIgnoresUnmanagedFiles(t *testing.T) {
	_, grant := pluginPackageProjectFixture(t)
	root, err := util.OpenPluginProjectDirectory(filepath.Join(util.PluginProjectRoot(grant.TaskID), "artifacts"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	export := filepath.Join(util.TempDir, "export")
	if err = os.MkdirAll(export, 0700); err != nil {
		t.Fatal(err)
	}
	var current string
	for i := 0; i < 9; i++ {
		data := []byte{byte(i)}
		current = util.PluginProjectDigest(data) + ".zip"
		if err = root.WriteFile(current, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(export, "plugin-project-other-"+current), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"notes.txt", ".package-interrupted.tmp"} {
		if err = root.WriteFile(name, []byte("recovery"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = prunePluginProjectArtifacts(grant, root, current); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{current, "notes.txt", ".package-interrupted.tmp"} {
		if _, err = root.Lstat(name); err != nil {
			t.Fatal("protected file removed", name, err)
		}
	}
	entries, err := os.ReadDir(export)
	if err != nil || len(entries) != 9 {
		t.Fatal("another task's deliveries changed", err)
	}
}
