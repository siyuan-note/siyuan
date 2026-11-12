// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetCleanupIgnoreRules(t *testing.T) {
	_, docPath := setupUnusedAssetWorkspace(t)
	if err := os.WriteFile(docPath, []byte(`{"Type":"NodeDocument","Spec":"1","Children":[{"Type":"NodeLinkDest","Data":"assets/plugin/referenced.png"}]}`), 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"plugin/keep.png", "plugin/tmp/remove.png", "plugin/referenced.png", "other.png", "paper.pdf", "paper.pdf.sya"} {
		p := filepath.Join(util.DataDir, "assets", name)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	rules := "# Rules\r\n/assets/plugin/**\r\n!/assets/plugin/**\r\n/assets/plugin/**\r\n!/assets/plugin/tmp/**\r\n!/assets/plugin/referenced.png\r\n/assets/paper.pdf\r\n"
	if _, err := SetAssetCleanupIgnore(rules, "missing"); err != nil {
		t.Fatal(err)
	}
	items, err := UnusedAssets(false)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, item := range items {
		seen[item.Item] = true
	}
	for _, p := range []string{"assets/plugin/keep.png", "assets/plugin", "assets/plugin/referenced.png", "assets/paper.pdf", "assets/paper.pdf.sya"} {
		if seen[p] {
			t.Errorf("protected candidate: %s", p)
		}
		if _, _, err := ResolveUnusedDataAssetPath(p); err == nil {
			t.Errorf("single cleanup admitted %s", p)
		}
	}
	for _, p := range []string{"assets/other.png", "assets/plugin/tmp/remove.png"} {
		if !seen[p] {
			t.Errorf("missing unused candidate: %s (%v)", p, seen)
		}
		if _, _, err := ResolveUnusedDataAssetPath(p); err != nil {
			t.Errorf("unprotected single cleanup rejected: %s: %v", p, err)
		}
	}
}

func TestAssetCleanupIgnoreActualPaths(t *testing.T) {
	box, _ := setupUnusedAssetWorkspace(t)
	if _, err := SetAssetCleanupIgnore("/assets/a.png\n", "missing"); err != nil {
		t.Fatal(err)
	}
	local := filepath.Join(util.DataDir, box, "assets", "a.png")
	global := filepath.Join(util.DataDir, "assets", "a.png")
	paths := map[string]string{"assets/a.png": local, "other-map-key": global}
	if err := excludeAssetCleanupIgnoredPaths(paths); err != nil {
		t.Fatal(err)
	}
	if paths["assets/a.png"] != local || paths["other-map-key"] != "" {
		t.Fatalf("matched flattened keys rather than actual data paths: %v", paths)
	}
}

func TestAssetCleanupIgnoreNotificationSwitch(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	p := filepath.Join(util.DataDir, "assets", "android-notification-texts.txt")
	if err := os.WriteFile(p, []byte("notification"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := AddAssetCleanupIgnore([]string{"assets/android-notification-texts.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err == nil {
		t.Fatal("notification exception bypassed explicit cleanup exclusion")
	}
}

func TestAssetCleanupIgnoreEmptyDirectoryAncestors(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	if _, err := SetAssetCleanupIgnore("/assets/a/keep/\n", "missing"); err != nil {
		t.Fatal(err)
	}
	paths := map[string]string{
		"assets/a/":           filepath.Join(util.DataDir, "assets", "a"),
		"assets/a/keep/":      filepath.Join(util.DataDir, "assets", "a", "keep"),
		"assets/a/remove.png": filepath.Join(util.DataDir, "assets", "a", "remove.png"),
	}
	if err := excludeAssetCleanupIgnoredPaths(paths); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths["assets/a/remove.png"] == "" {
		t.Fatalf("empty protected directory lost its ancestors: %v", paths)
	}
}

func TestAssetCleanupIgnoreEditing(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	initial, err := GetAssetCleanupIgnore()
	if err != nil || initial.Revision != "missing" {
		t.Fatalf("initial: %+v %v", initial, err)
	}
	first, err := SetAssetCleanupIgnore("# Keep order\n!/assets/a.png", initial.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = SetAssetCleanupIgnore("", initial.Revision); !errors.Is(err, ErrAssetCleanupIgnoreConflict) {
		t.Fatalf("stale save: %v", err)
	}
	updated, err := AddAssetCleanupIgnore([]string{"assets/a.png", "assets/a.png", "assets/sp ace,[x]+(1)%.png"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(updated.Content, first.Content+"\n") || strings.Count(updated.Content, "\n/assets/a.png\n") != 1 {
		t.Fatalf("rules rewritten: %s", updated.Content)
	}
	again, err := AddAssetCleanupIgnore([]string{"assets/a.png"})
	if err != nil || again.Revision != updated.Revision {
		t.Fatalf("addition not idempotent: %+v %v", again, err)
	}
	matcher, err := compileAssetCleanupIgnore(updated.Content)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"assets/a.png", "assets/sp ace,[x]+(1)%.png"} {
		if !matcher.MatchesPath("/" + p) {
			t.Errorf("literal did not match: %s", p)
		}
	}
	literalStar, err := compileAssetCleanupIgnore(assetCleanupIgnoreLiteral("assets/star*.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !literalStar.MatchesPath("/assets/star*.png") || literalStar.MatchesPath("/assets/star-other.png") {
		t.Fatal("literal star became wildcard")
	}
	for _, p := range []string{"../assets/a.png", "/assets/a.png", "assets/../a.png", "assets/sub/", "assets/a:stream", "assets/a\nb"} {
		if _, err := AddAssetCleanupIgnore([]string{p}); err == nil {
			t.Errorf("invalid path accepted: %q", p)
		}
	}
	current, _ := GetAssetCleanupIgnore()
	if current.Revision != again.Revision {
		t.Fatal("invalid batch changed rules")
	}
}

func TestAssetCleanupIgnoreConcurrentAdditions(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, p := range []string{"assets/a.png", "assets/b.png"} {
		wg.Add(1)
		go func(p string) { defer wg.Done(); _, err := AddAssetCleanupIgnore([]string{p}); errs <- err }(p)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	state, _ := GetAssetCleanupIgnore()
	if !strings.Contains(state.Content, "/assets/a.png") || !strings.Contains(state.Content, "/assets/b.png") {
		t.Fatal(state.Content)
	}
}

func TestAssetCleanupIgnoreFailuresAndDigest(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	before, err := ordinaryAssetCleanupSourceDigest()
	if err != nil {
		t.Fatal(err)
	}
	state, err := SetAssetCleanupIgnore("/assets/a.png\n", "missing")
	if err != nil {
		t.Fatal(err)
	}
	after, err := ordinaryAssetCleanupSourceDigest()
	if err != nil || before == after {
		t.Fatalf("missing creation digest: %v", err)
	}
	if _, err = SetAssetCleanupIgnore("", state.Revision); err != nil {
		t.Fatal(err)
	}
	empty, err := ordinaryAssetCleanupSourceDigest()
	if err != nil || empty == before || empty == after {
		t.Fatalf("missing empty-file digest: %v", err)
	}
	p := filepath.Join(util.DataDir, filepath.FromSlash(assetCleanupIgnorePath))
	for _, content := range []string{"[", "!", "/assets/#$~#$~", "<<<<<<< local\n/assets/a.png", string([]byte{255}), "bad\x00rule"} {
		if err = os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err = UnusedAssets(false); err == nil {
			t.Errorf("invalid rules accepted: %q", content)
		}
		if _, err = ordinaryAssetCleanupSourceDigest(); err == nil {
			t.Errorf("invalid source digest accepted: %q", content)
		}
	}
	if err = os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(p, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = UnusedAssets(false); err == nil {
		t.Fatal("rule directory accepted")
	}
}

func TestAssetCleanupIgnoreMatcherCompatibility(t *testing.T) {
	for _, content := range []string{"/assets/**\n!/assets/tmp/**\n/assets/tmp/keep.png", "# comment\r\n\r\n/assets/*.png\r\n", "assets/a?.png", "/assets/x[ab].png", "/assets/a.png\n!/assets/a.png\n/assets/a.png"} {
		matcher, err := compileAssetCleanupIgnore(content)
		if err != nil {
			t.Fatal(err)
		}
		original := ignore.CompileIgnoreLines(strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")...)
		for _, p := range []string{"/assets/a.png", "/assets/a?.png", "/assets/tmp/x.png", "/assets/tmp/keep.png", "/assets/xa.png"} {
			if matcher.MatchesPath(p) != original.MatchesPath(p) {
				t.Fatalf("syntax mismatch %q %q", content, p)
			}
		}
	}
}

func TestAssetCleanupIgnoreSymlinkBoundaries(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(util.DataDir, "assets", "linked.png")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := AddAssetCleanupIgnore([]string{"assets/linked.png"}); err == nil {
		t.Fatal("external symlink was accepted")
	}
	p := filepath.Join(util.DataDir, filepath.FromSlash(assetCleanupIgnorePath))
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, p); err != nil {
		t.Fatal(err)
	}
	if _, err := UnusedAssets(false); err == nil {
		t.Fatal("external rules symlink was accepted")
	}
}

func TestAssetCleanupIgnoreProtectedUpload(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	cacheAssetUploadTestFile(t, filepath.Join(util.DataDir, "assets"), "image-20261112000000-abcdefg.png", []byte("protected upload"))
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{{name: "image.png", data: []byte("protected upload")}}, nil)
	result, _, err := UploadAssets(AssetUploadRequest{Files: request.MultipartForm.File["file[]"], ExcludeFromCleanup: true})
	if err != nil || result == nil || len(result.SuccFiles) != 1 {
		t.Fatalf("upload: %+v %v", result, err)
	}
	if _, _, err = ResolveUnusedDataAssetPath(result.SuccFiles[0].Path); err == nil {
		t.Fatal("successful protected upload can be cleaned")
	}
	bad := "assets/../other"
	if _, _, err = UploadAssets(AssetUploadRequest{AssetsDirPath: &bad, ExcludeFromCleanup: true}); err == nil {
		t.Fatal("escaping upload directory accepted")
	}
}

func TestAssetCleanupIgnoreUploadDoesNotReuseNotebookAsset(t *testing.T) {
	box, _ := setupUnusedAssetWorkspace(t)
	data := []byte("notebook-only protected upload")
	name := "image-20261112000000-abcdefg.png"
	local := filepath.Join(util.DataDir, box, "assets", name)
	if err := os.MkdirAll(filepath.Dir(local), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(local, data, 0644); err != nil {
		t.Fatal(err)
	}
	if reusableCleanupUploadAsset("assets/"+name) || reusableCleanupUploadAsset(box+"/assets/"+name) {
		t.Fatal("notebook-only asset was reusable as a global protected upload")
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, "assets", name), data, 0644); err != nil {
		t.Fatal(err)
	}
	if !reusableCleanupUploadAsset("assets/" + name) {
		t.Fatal("existing global file was not reusable")
	}
}

func TestAssetCleanupIgnoreUploadRegistrationFailure(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	name := "image-20261112000000-abcdefg.png"
	data := []byte("reused upload must survive registration failure")
	cacheAssetUploadTestFile(t, filepath.Join(util.DataDir, "assets"), name, data)
	content := "#" + strings.Repeat("x", assetCleanupIgnoreMaxSize-2) + "\n"
	if _, err := SetAssetCleanupIgnore(content, "missing"); err != nil {
		t.Fatal(err)
	}
	request := newAssetUploadTestRequest(t, []assetUploadTestFile{{name: "image.png", data: data}}, nil)
	result, _, err := UploadAssets(AssetUploadRequest{Files: request.MultipartForm.File["file[]"], ExcludeFromCleanup: true})
	if err == nil || result != nil {
		t.Fatalf("registration failure was reported as success: %+v %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "assets", name)); err != nil {
		t.Fatalf("reused asset was deleted: %v", err)
	}
}
