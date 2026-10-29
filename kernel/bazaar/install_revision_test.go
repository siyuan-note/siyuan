// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func useInstallRevisionFixture(t *testing.T) (source, target string) {
	t.Helper()
	oldConf, oldData, oldTemp := util.ConfDir, util.DataDir, util.TempDir
	root := t.TempDir()
	util.ConfDir, util.DataDir, util.TempDir = filepath.Join(root, "conf"), filepath.Join(root, "data"), filepath.Join(root, "temp")
	t.Cleanup(func() { util.ConfDir, util.DataDir, util.TempDir = oldConf, oldData, oldTemp })
	source, target = filepath.Join(root, "source"), filepath.Join(util.DataDir, "plugins", "sample")
	for directory, code := range map[string]string{source: "new", target: "old"} {
		if err := os.MkdirAll(directory, 0755); err != nil {
			t.Fatal(err)
		}
		for name, value := range map[string]string{"plugin.json": `{"name":"sample","version":"1.0.0"}`, "index.js": code} {
			if err := os.WriteFile(filepath.Join(directory, name), []byte(value), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	return source, target
}

func installRevisionOptions(target string) PackageInstallOptions {
	revision, _ := InstalledPackageRevision(target)
	return PackageInstallOptions{ExpectedInstalledRevision: revision}
}

func TestInstallRevisionConflictHasNoReplacement(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	if err := os.WriteFile(filepath.Join(target, "index.js"), []byte("external edit"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := replacePackageDirectoryWithOptions(source, target, true, options)
	if !errors.Is(err, ErrInstalledRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(target, "index.js"))
	if string(data) != "external edit" {
		t.Fatal("stale install changed target")
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	if len(entries) != 1 {
		t.Fatalf("stale install left staging: %v", entries)
	}
}

func TestInstallRevisionRejectsTargetChangeDuringStaging(t *testing.T) {
	for _, change := range []string{"edit", "create", "delete", "empty directory"} {
		t.Run(change, func(t *testing.T) {
			source, target := useInstallRevisionFixture(t)
			update := change == "edit" || change == "delete"
			if !update {
				if err := os.RemoveAll(target); err != nil {
					t.Fatal(err)
				}
			}
			changedRevision := ""
			// 在线安装未显式绑定版本；在 staging 完成后模拟另一个写入方修改目标。
			options := PackageInstallOptions{Recheck: func() error {
				staged, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-package-install-*", "staging", "index.js"))
				if err != nil || len(staged) == 0 || changedRevision != "" {
					return err
				}
				switch change {
				case "delete":
					err = os.RemoveAll(target)
				case "empty directory":
					err = os.MkdirAll(target, 0755)
				default:
					if err = os.MkdirAll(target, 0755); err == nil {
						err = os.WriteFile(filepath.Join(target, "index.js"), []byte("concurrent edit"), 0644)
					}
				}
				if err != nil {
					return err
				}
				changedRevision, err = installedPackageRevision(target)
				return err
			}}
			if _, err := replacePackageDirectoryWithOptions(source, target, update, options); !errors.Is(err, ErrInstalledRevisionConflict) {
				t.Fatalf("target change was not rejected: %v", err)
			}
			if changedRevision == "" {
				t.Fatal("target was not changed during staging")
			}
			if revision, err := InstalledPackageRevision(target); err != nil || revision != changedRevision {
				t.Fatalf("concurrent change was lost: %s, %v", revision, err)
			}
			if paths, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-package-install-*")); err != nil || len(paths) != 0 {
				t.Fatalf("conflicting installation left staging: %v, %v", paths, err)
			}
		})
	}
}

func TestInstallRevisionMissingBinding(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := PackageInstallOptions{ExpectedInstalledRevision: MissingInstalledRevision}
	if _, err := replacePackageDirectoryWithOptions(source, target, true, options); !errors.Is(err, ErrInstalledRevisionConflict) {
		t.Fatalf("missing binding accepted existing target: %v", err)
	}
	if err := os.RemoveAll(target); err != nil {
		t.Fatal(err)
	}
	if revision, err := InstalledPackageRevision(target); err != nil || revision != MissingInstalledRevision {
		t.Fatalf("missing revision = %s, %v", revision, err)
	}
	result, err := replacePackageDirectoryWithOptions(source, target, false, options)
	if err != nil || !validInstallHash(result.InstalledRevision) || result.PreviousRevision != MissingInstalledRevision {
		t.Fatalf("missing install = %+v, %v", result, err)
	}
}

func TestInstallRevisionFinalRecheckRejectsExternalChange(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	options.BeforeReplace = func() error { return os.WriteFile(filepath.Join(target, "index.js"), []byte("external edit"), 0644) }
	_, err := replacePackageDirectoryWithOptions(source, target, true, options)
	if !errors.Is(err, ErrInstalledRevisionConflict) {
		t.Fatalf("expected final recheck conflict, got %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(target, "index.js"))
	if string(data) != "external edit" {
		t.Fatal("final recheck overwrote external edit")
	}
}

func TestInstallRevisionFinalRecheckRejectsChangedStaging(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	options.BeforeReplace = func() error {
		staged, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-package-install-*", "staging", "index.js"))
		if err != nil || len(staged) != 1 {
			return fmt.Errorf("unexpected staging files: %v, %v", staged, err)
		}
		return os.WriteFile(staged[0], []byte("unapproved"), 0644)
	}
	_, err := replacePackageDirectoryWithOptions(source, target, true, options)
	if !errors.Is(err, ErrInstalledRevisionConflict) {
		t.Fatalf("changed staging accepted: %v", err)
	}
	revision, _ := InstalledPackageRevision(target)
	if revision != options.ExpectedInstalledRevision {
		t.Fatal("changed staging reached installed target")
	}
}

func TestInstallRevisionOnlineAndLocalShareReplacementLock(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	entered, release := make(chan struct{}), make(chan struct{})
	localOptions := options
	localOptions.BeforeReplace = func() error { close(entered); <-release; return nil }
	localDone := make(chan error, 1)
	go func() {
		_, err := replacePackageDirectoryWithOptions(source, target, true, localOptions)
		localDone <- err
	}()
	<-entered
	onlineDone := make(chan error, 1)
	archive := buildInstallPackageArchive(t, map[string]string{"plugin.json": `{"name":"sample","version":"2.0.0"}`, "index.js": "online"})
	go func() {
		_, err := installPackageWithOptions(archive, target, "plugins", "sample", true, options)
		onlineDone <- err
	}()
	close(release)
	if err := <-localDone; err != nil {
		t.Fatal(err)
	}
	if err := <-onlineDone; !errors.Is(err, ErrInstalledRevisionConflict) {
		t.Fatalf("online install did not reject stale revision: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(target, "index.js"))
	if string(data) != "new" {
		t.Fatal("online installer overwrote local replacement")
	}
}

func TestInstallArchiveHashConsumesVerifiedSnapshot(t *testing.T) {
	_, target := useInstallRevisionFixture(t)
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	writeLocalPackageArchive(t, archivePath, map[string]string{"plugin.json": `{"name":"sample","version":"2.0.0"}`, "index.js": "approved"})
	data, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	// 解压统一落在 temp，哈希不符时不应在其中留下任何内容
	if err := os.MkdirAll(util.TempDir, 0755); err != nil {
		t.Fatal(err)
	}
	_, _, _, _, cleanup, err := ExtractLocalPackageWithHash(archivePath, strings.Repeat("0", 64))
	cleanup()
	if !errors.Is(err, ErrPackageHashConflict) {
		t.Fatalf("wrong archive hash was accepted: %v", err)
	}
	if entries, err := os.ReadDir(util.TempDir); err != nil || len(entries) != 0 {
		t.Fatalf("hash failure created extraction directory: %#v, %v", entries, err)
	}
	_, _, source, gotHash, cleanup, err := ExtractLocalPackageWithHash(archivePath, hash)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if !util.IsForbiddenAbsPath(filepath.Join(source, "index.js")) ||
		!util.IsPluginDevelopmentRawPathForbidden(source, true) {
		t.Fatal("hash-bound extraction is accessible through raw file APIs")
	}
	if gotHash != hash {
		t.Fatal("incorrect archive hash")
	}
	writeLocalPackageArchive(t, archivePath, map[string]string{"plugin.json": `{"name":"sample","version":"9.0.0"}`, "index.js": "unapproved"})
	if err = replacePackageDirectory(source, target, true); err != nil {
		t.Fatal(err)
	}
	installed, _ := os.ReadFile(filepath.Join(target, "index.js"))
	if string(installed) != "approved" {
		t.Fatal("installer reopened mutable original archive")
	}
}

func TestInspectLocalArchiveIsReadOnlyAndRejectsNullManifest(t *testing.T) {
	_, _ = useInstallRevisionFixture(t)
	archive := filepath.Join(t.TempDir(), "wrapped.zip")
	writeLocalPackageArchive(t, archive, map[string]string{"wrapper/plugin.json": `{"name":"sample","version":"1.0.0"}`, "wrapper/index.js": "old"})
	pkgType, pkg, hash, err := InspectLocalPackageWithHash(archive, "")
	if err != nil || pkgType != "plugins" || pkg.Name != "sample" || !validInstallHash(hash) {
		t.Fatalf("inspect = %s, %+v, %s, %v", pkgType, pkg, hash, err)
	}
	if _, err = os.Stat(util.ConfDir); !os.IsNotExist(err) {
		t.Fatal("inspection created private directories")
	}
	writeLocalPackageArchive(t, archive, map[string]string{"plugin.json": "null"})
	if _, _, _, err = InspectLocalPackageWithHash(archive, ""); err == nil {
		t.Fatal("null manifest accepted")
	}
	_, _, _, cleanup, err := ExtractLocalPackage(archive)
	cleanup()
	if err == nil {
		t.Fatal("null manifest extracted")
	}
}

func TestInstallRevisionRejectsLinksAndCollidingArchives(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	if err := os.Link(filepath.Join(source, "index.js"), filepath.Join(source, "hard.js")); err == nil {
		if _, err = InstalledPackageRevision(source); err == nil {
			t.Fatal("hard link accepted")
		}
		os.Remove(filepath.Join(source, "hard.js"))
	}
	if err := os.Symlink(filepath.Join(target, "index.js"), filepath.Join(source, "link.js")); err == nil {
		if _, err = InstalledPackageRevision(source); err == nil {
			t.Fatal("symbolic link accepted")
		}
	}
	archivePath := filepath.Join(t.TempDir(), "collision.zip")
	writeLocalPackageArchive(t, archivePath, map[string]string{"plugin.json": `{"name":"sample"}`, "INDEX.js": "one", "index.js": "two"})
	_, _, _, cleanup, err := ExtractLocalPackage(archivePath)
	cleanup()
	if err == nil {
		t.Fatal("case-colliding ZIP paths accepted")
	}
}
