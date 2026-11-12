// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBoxDocCountCacheSourceMutations(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxID := fixture.box.ID
	assertCount := func(want int) {
		t.Helper()
		if got := BoxDocSubFileCount(boxID); got != want {
			t.Fatalf("document count = %d, want %d", got, want)
		}
	}
	assertCount(2)
	assertCount(2)
	created := addFileOperationTestDoc(t, fixture, "20261112000001-count01", "Created", false)
	assertCount(3)
	created.Root.SetIALAttr(DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(created); err != nil {
		t.Fatal(err)
	}
	assertCount(2)
	created.Root.RemoveIALAttr(DocHiddenAttr)
	if _, err := filesys.WriteTree(created); err != nil {
		t.Fatal(err)
	}
	assertCount(3)
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID, fixture.sourceID), 0700); err != nil {
		t.Fatal(err)
	}
	nestedPath := "/" + fixture.sourceID + created.Path
	if err := fixture.box.Move(created.Path, nestedPath); err != nil {
		t.Fatal(err)
	}
	assertCount(2)
	if count := BoxDocSubFileCountForPublishAt(boxID, fixture.sourcePath, PublishAccess{}); count != 1 {
		t.Fatalf("moved child count = %d, want 1", count)
	}
	if err := fixture.box.Move(nestedPath, created.Path); err != nil {
		t.Fatal(err)
	}
	assertCount(3)
	if count := BoxDocSubFileCountForPublishAt(boxID, fixture.sourcePath, PublishAccess{}); count != 0 {
		t.Fatalf("moved-away child count = %d, want 0", count)
	}
	if err := fixture.box.Remove(created.Path); err != nil {
		t.Fatal(err)
	}
	assertCount(2)
	finish := cache.BeginDocTreeMutation("")
	data := []byte(`{"Properties":{"id":"` + fixture.targetID + `","custom-hidden":"true"}}`)
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, fixture.targetPath), data, 0600); err != nil {
		finish()
		t.Fatal(err)
	}
	finish()
	assertCount(1)
}

func TestBoxDocCountCachePreservesBodyAndSortChanges(t *testing.T) {
	fixture := setupFileOperationTest(t)
	if got := BoxDocSubFileCount(fixture.box.ID); got != 2 {
		t.Fatal(got)
	}
	tree, err := filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.AppendChild(treenode.NewParagraph("Edited content"))
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	if err := writeSortConfMap(filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json"),
		map[string]int{fixture.sourceID: 2, fixture.targetID: 1}); err != nil {
		t.Fatal(err)
	}
	originalAcquire := filesys.DEKLockAcquire
	reads := 0
	filesys.DEKLockAcquire = func(box string) {
		reads++
		if originalAcquire != nil {
			originalAcquire(box)
		}
	}
	t.Cleanup(func() { filesys.DEKLockAcquire = originalAcquire })
	if got := BoxDocSubFileCount(fixture.box.ID); got != 2 || reads != 0 {
		t.Fatalf("unchanged visibility rescanned sources: count=%d reads=%d", got, reads)
	}
}

func TestBoxDocCountCachePolicyAndWorkspaceIsolation(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxID := fixture.box.ID
	if got := BoxDocSubFileCount(boxID); got != 2 {
		t.Fatal(got)
	}
	policy := PublishAccess{{ID: fixture.sourceID, Visible: false}}
	if got := BoxDocSubFileCountForPublish(boxID, policy); got != 1 {
		t.Fatal(got)
	}
	policy[0].Visible = true
	if got := BoxDocSubFileCountForPublish(boxID, policy); got != 2 {
		t.Fatalf("changed policy reused a count: %d", got)
	}
	policy[0].Visible = false
	if got := BoxDocSubFileCountForPublish(boxID, policy); got != 1 {
		t.Fatal(got)
	}
	if got := BoxDocSubFileCount(boxID); got != 2 {
		t.Fatalf("published count escaped to owner: %d", got)
	}
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = originalDataDir })
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID), 0700); err != nil {
		t.Fatal(err)
	}
	if got := BoxDocSubFileCount(boxID); got != 0 {
		t.Fatalf("count escaped to another workspace: %d", got)
	}
}

func TestBoxDocCountCacheRejectsFailedAndNewerSources(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"corrupt", `{"Properties":{"title":"Truncated"},"Children":[`},
		{"newer-spec", `{"Spec":"999","Properties":{"title":"Future"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			absPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			if err := os.WriteFile(absPath, []byte(test.source), 0600); err != nil {
				t.Fatal(err)
			}
			cache.InvalidateDocTree(fixture.box.ID)
			BoxDocSubFileCount(fixture.box.ID)
			after, err := os.ReadFile(absPath)
			if err != nil || string(after) != test.source {
				t.Fatalf("count changed unreadable source: %q %v", after, err)
			}
			hidden := []byte(`{"Properties":{"id":"` + fixture.sourceID + `","custom-hidden":"true"}}`)
			if err = os.WriteFile(absPath, hidden, 0600); err != nil {
				t.Fatal(err)
			}
			if got := BoxDocSubFileCount(fixture.box.ID); got != 1 {
				t.Fatalf("failed source scan was cached: %d", got)
			}
		})
	}
}

func TestBoxDocCountCacheRejectsChangedSourceDuringScan(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalRelease := filesys.DEKLockRelease
	changed := false
	filesys.DEKLockRelease = func(box string) {
		if originalRelease != nil {
			originalRelease(box)
		}
		if changed {
			return
		}
		changed = true
		finish := cache.BeginDocTreeMutation(fixture.box.ID)
		defer finish()
		data := []byte(`{"Properties":{"id":"` + fixture.sourceID + `","custom-hidden":"true"}}`)
		if err := os.WriteFile(filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { filesys.DEKLockRelease = originalRelease })
	BoxDocSubFileCount(fixture.box.ID)
	if !changed {
		t.Fatal("source mutation was not exercised")
	}
	if got := BoxDocSubFileCount(fixture.box.ID); got != 1 {
		t.Fatalf("in-flight old count was retained: %d", got)
	}
}

func BenchmarkBoxDocCountCache(b *testing.B) {
	fixture := setupFileOperationTest(b)
	for index := 0; index < 1000; index++ {
		id := fmt.Sprintf("20261112000000-%07d", index)
		data := []byte(`{"Properties":{"id":"` + id + `","title":"Document"},"Children":[{"Data":"` + strings.Repeat("x", 128*1024) + `"}]}`)
		if err := os.WriteFile(filepath.Join(util.DataDir, fixture.box.ID, id+".sy"), data, 0600); err != nil {
			b.Fatal(err)
		}
	}
	for _, cold := range []bool{true, false} {
		b.Run(fmt.Sprintf("cold=%v", cold), func(b *testing.B) {
			if got := BoxDocSubFileCount(fixture.box.ID); got != 1002 {
				b.Fatal(got)
			}
			b.ResetTimer()
			for b.Loop() {
				if cold {
					cache.InvalidateDocTree(fixture.box.ID)
				}
				if got := BoxDocSubFileCount(fixture.box.ID); got != 1002 {
					b.Fatal(got)
				}
			}
		})
	}
}
