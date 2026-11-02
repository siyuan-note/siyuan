// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocTreeRangeRetriesPendingWriter(t *testing.T) {
	fixture := setupFileOperationTest(t)
	for _, locate := range []bool{false, true} {
		finish := cache.BeginDocTreeMutation(fixture.box.ID)
		done := make(chan struct{})
		go func() {
			time.Sleep(10 * time.Millisecond)
			finish()
			close(done)
		}()
		var err error
		if locate {
			_, err = LocateDocTreeItem(context.Background(), fixture.box.ID, fixture.sourceID, DocTreeAccess{})
		} else {
			_, err = ListDocTreeRange(context.Background(), fixture.box.ID, "", 0, 32, "", DocTreeAccess{})
		}
		<-done
		if err != nil {
			t.Fatalf("pending writer (locate=%v): %v", locate, err)
		}
	}
	finish := cache.BeginDocTreeMutation(fixture.box.ID)
	defer finish()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 32, "", DocTreeAccess{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("retry ignored cancellation: %v", err)
	}
}

func TestDocTreeRangeCompleteAndLocate(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	access := DocTreeAccess{}
	for i := 0; i < 23; i++ {
		addFileOperationTestDoc(t, fixture, fmt.Sprintf("2026071801%04d-abcdefg", i), fmt.Sprintf("Item %d", i), i == 12)
	}
	var previous string
	var got []string
	for offset := 0; ; offset += 4 {
		batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", offset, 4, previous, access)
		if err != nil || batch.Stale || batch.Total != 24 || len(batch.Files) > 4 {
			t.Fatalf("range %d: %+v, %v", offset, batch, err)
		}
		previous = batch.Revision
		for _, file := range batch.Files {
			got = append(got, file.ID)
		}
		if offset+4 >= batch.Total {
			break
		}
	}
	legacy, _, err := ListDocTree(fixture.box.ID, "/", util.SortModeUnassigned, false, false, 1000)
	if err != nil {
		t.Fatal(err)
	}
	var want []string
	for _, file := range legacy {
		want = append(want, file.ID)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("range order lost or duplicated entries: %v, want %v", got, want)
	}
	last := got[len(got)-1]
	located, err := LocateDocTreeItem(ctx, fixture.box.ID, last, access)
	if err != nil || len(located) != 1 || located[0].Index != 23 || located[0].Revision != previous {
		t.Fatalf("last entry location: %+v, %v", located, err)
	}
	addFileOperationTestDoc(t, fixture, "20260718020000-newdoc1", "New", false)
	stale, err := ListDocTreeRange(ctx, fixture.box.ID, "", 4, 4, previous, access)
	if err != nil || !stale.Stale || stale.Total != 25 || len(stale.Files) != 0 || stale.Revision == previous {
		t.Fatalf("old revision mixed with changed source: %+v, %v", stale, err)
	}
	tail, err := ListDocTreeRange(ctx, fixture.box.ID, "", 99999, 4, "", access)
	if err != nil || tail.Offset != 25 || len(tail.Files) != 0 {
		t.Fatalf("out of range offset: %+v, %v", tail, err)
	}
}

func TestDocTreeRangeVisibilityAndSourceFailure(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	access := DocTreeAccess{Published: true, Policy: PublishAccess{{ID: fixture.sourceID, Visible: false}}}
	batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 1, "", access)
	if err != nil || batch.Total != 1 || len(batch.Files) != 1 || batch.Files[0].ID != fixture.targetID {
		t.Fatalf("publish filtering occurred after slice: %+v, %v", batch, err)
	}
	if _, err = LocateDocTreeItem(ctx, fixture.box.ID, fixture.sourceID, access); err == nil {
		t.Fatal("located an unpublished document")
	}
	hidden := addFileOperationTestDoc(t, fixture, "20260718030000-hidden1", "Hidden", true)
	child := treenode.NewTree(fixture.box.ID, "/"+hidden.ID+"/20260718030001-child01.sy", "/Hidden/Child", "Child")
	if _, err = filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(child)
	if _, err = ListDocTreeRange(ctx, fixture.box.ID, hidden.ID, 0, 4, "", DocTreeAccess{}); err == nil {
		t.Fatal("hidden parent accepted")
	}
	if _, err = LocateDocTreeItem(ctx, fixture.box.ID, child.ID, DocTreeAccess{}); err == nil {
		t.Fatal("hidden ancestor accepted")
	}
	broken := filepath.Join(util.DataDir, fixture.box.ID, "20260718030002-broken1.sy")
	bytes := []byte("{ invalid source")
	if err = os.WriteFile(broken, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	cache.InvalidateDocTree(fixture.box.ID)
	if _, err = ListDocTreeRange(ctx, fixture.box.ID, "", 0, 4, "", DocTreeAccess{}); err == nil {
		t.Fatal("corrupt source silently omitted from a complete snapshot")
	}
	after, err := os.ReadFile(broken)
	if err != nil || string(after) != string(bytes) {
		t.Fatalf("range query changed corrupt source: %q, %v", after, err)
	}
}

func TestDocTreeRangeNestedAndSortMutation(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	child := treenode.NewTree(fixture.box.ID, "/"+fixture.sourceID+"/20260718040000-child01.sy", "/Source/Child", "Child")
	for _, tree := range []*parse.Tree{child} {
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	steps, err := LocateDocTreeItem(ctx, fixture.box.ID, child.ID, DocTreeAccess{})
	if err != nil || len(steps) != 2 || steps[0].ParentID != "" || steps[1].ParentID != fixture.sourceID || steps[1].Index != 0 {
		t.Fatalf("ancestor locations: %+v, %v", steps, err)
	}
	first, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, "", DocTreeAccess{})
	if err != nil {
		t.Fatal(err)
	}
	if err = writeSortConfMap(filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json"), map[string]int{fixture.sourceID: 1, fixture.targetID: 2}); err != nil {
		t.Fatal(err)
	}
	changed, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, first.Revision, DocTreeAccess{})
	if err != nil || !changed.Stale {
		t.Fatalf("sort mutation did not invalidate: %+v, %v", changed, err)
	}
	changed, err = ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, "", DocTreeAccess{})
	if err != nil || changed.Files[0].ID != fixture.sourceID || changed.Files[0].Sort != 1 || changed.Files[0].SubFileCount != 1 {
		t.Fatalf("custom order and child count: %+v, %v", changed, err)
	}
}

func TestDocTreeRangeChildCountCache(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	count := 128
	if configured, err := strconv.Atoi(os.Getenv("SIYUAN_TEST_DOC_TREE_SIZE")); err == nil && configured >= count && configured <= 100000 {
		count = configured
	}
	directory := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourceID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("20260718070000-%07d", index)
		data, err := json.Marshal(map[string]interface{}{"ID": id, "Type": "NodeDocument", "Spec": "1",
			"Properties": map[string]string{"id": id, "title": "Child", "updated": "20260718070000"}})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(directory, id+".sy"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	cache.InvalidateDocTree(fixture.box.ID)
	access := DocTreeAccess{}
	readParent := func(revision string, want int) *DocTreeRange {
		t.Helper()
		steps, err := LocateDocTreeItem(ctx, fixture.box.ID, fixture.sourceID, access)
		if err != nil || len(steps) != 1 {
			t.Fatalf("parent location: %+v, %v", steps, err)
		}
		batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", steps[0].Index, 1, revision, access)
		if err != nil || batch.Stale || len(batch.Files) != 1 || batch.Files[0].ID != fixture.sourceID || batch.Files[0].SubFileCount != want {
			t.Fatalf("parent count %d: %+v, %v", want, batch, err)
		}
		return batch
	}
	first := readParent("", count)
	previousAcquire := filesys.DEKLockAcquire
	reads := 0
	filesys.DEKLockAcquire = func(box string) {
		reads++
		if previousAcquire != nil {
			previousAcquire(box)
		}
	}
	defer func() { filesys.DEKLockAcquire = previousAcquire }()
	started := time.Now()
	readParent(first.Revision, count)
	if reads != 1 {
		t.Fatalf("warm parent scanned %d sources for %d children, want only the parent", reads, count)
	}
	t.Logf("children=%d warm-parent-reads=%d elapsed=%s", count, reads, time.Since(started))
	// 新建同级文档与写入排序配置不能让已有大目录再次扫描全部子文档。
	reads = 0
	started = time.Now()
	sibling := addFileOperationTestDoc(t, fixture, "20260718070002-sibling", "Sibling", false)
	sortPath := filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json")
	if err := writeSortConfMap(sortPath, map[string]int{fixture.sourceID: 1, fixture.targetID: 2}); err != nil {
		t.Fatal(err)
	}
	sortData, err := os.ReadFile(sortPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = appendSortConfMap(sortPath, sortData, map[string]int{sibling.ID: 3}); err != nil {
		t.Fatal(err)
	}
	readParent("", count)
	if reads > 8 {
		t.Fatalf("sibling creation rescanned children: reads=%d children=%d", reads, count)
	}
	t.Logf("children=%d sibling-refresh-reads=%d elapsed=%s", count, reads, time.Since(started))
	child := treenode.NewTree(fixture.box.ID, "/"+fixture.sourceID+"/20260718070001-newdoc1.sy", "/Source/New", "New")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(child)
	created := readParent("", count+1)
	if created.Revision == first.Revision {
		t.Fatal("new child retained the parent count revision")
	}
	child.Root.SetIALAttr(DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	readParent("", count)
	child.Root.SetIALAttr(DocHiddenAttr, "false")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	readParent("", count+1)
	access = DocTreeAccess{Published: true, Policy: PublishAccess{{ID: child.ID, Visible: false}}}
	readParent("", count)
	access = DocTreeAccess{}
	readParent("", count+1)
	if err := fixture.box.Remove(child.Path); err != nil {
		t.Fatal(err)
	}
	readParent("", count)
	// 按子文档数排序时，排序阶段已算出的计数不能在构造响应时重复扫描。
	Conf.FileTree.Load().Sort = util.SortModeSubDocCountDESC
	reads = 0
	batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 1, "", access)
	if err != nil || len(batch.Files) != 1 || batch.Files[0].SubFileCount != count || reads != count+4 {
		t.Fatalf("count sort repeated metadata scan: batch=%+v reads=%d, err=%v", batch, reads, err)
	}
}

func TestDocTreeRangeSortModesAndDeletion(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	access := DocTreeAccess{}
	for index, name := range []string{"Item 2", "Item 10", "same", "same"} {
		addFileOperationTestDoc(t, fixture, fmt.Sprintf("2026071806000%d-sort001", index), name, false)
	}
	var latest *DocTreeRange
	for mode := util.SortModeNameASC; mode <= util.SortModeSubDocCountDESC; mode++ {
		Conf.FileTree.Load().Sort = mode
		var err error
		latest, err = ListDocTreeRange(ctx, fixture.box.ID, "", 0, 100, "", access)
		if err != nil {
			t.Fatalf("mode %d: %v", mode, err)
		}
		legacy, _, err := ListDocTree(fixture.box.ID, "/", mode, false, false, 100)
		if err != nil || len(legacy) != len(latest.Files) {
			t.Fatalf("mode %d legacy: %v", mode, err)
		}
		for index, file := range legacy {
			if latest.Files[index].ID != file.ID {
				t.Fatalf("mode %d row %d: %s, want %s", mode, index, latest.Files[index].ID, file.ID)
			}
		}
	}
	if err := fixture.box.Remove(fixture.sourcePath); err != nil {
		t.Fatal(err)
	}
	deleted, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 100, latest.Revision, access)
	if err != nil || !deleted.Stale || deleted.Total != latest.Total-1 {
		t.Fatalf("deletion retained cached rows: %+v, %v", deleted, err)
	}
	if _, err = ListDocTreeRange(ctx, fixture.box.ID, fixture.sourceID, 0, 100, "", access); err == nil {
		t.Fatal("deleted parent treated as an empty available directory")
	}
	if _, err = LocateDocTreeItem(ctx, fixture.box.ID, fixture.sourceID, access); err == nil {
		t.Fatal("deleted target located from an old identity index")
	}
	corrupt := []byte("{ corrupt sort")
	filename := filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json")
	if err = os.WriteFile(filename, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	cache.InvalidateDocTree(fixture.box.ID)
	if _, err = ListDocTreeRange(ctx, fixture.box.ID, "", 0, 100, "", access); err == nil {
		t.Fatal("corrupt sort silently repaired by a range query")
	}
	got, err := os.ReadFile(filename)
	if err != nil || string(got) != string(corrupt) {
		t.Fatalf("corrupt sort was changed: %q, %v", got, err)
	}
}

func TestDocTreeRangeRejectsRevokedPublishContext(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previous := GetPublishAccess()
	t.Cleanup(func() { _ = SetPublishAccess(previous) })
	if err := SetPublishAccess(PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	policy := GetPublishAccess()
	access := DocTreeAccess{Published: true, Policy: policy, PolicyRevision: DocTreePublishAccessRevision(policy)}
	if _, err := ListDocTreeRange(context.Background(), fixture.box.ID, "", 0, 1, "", access); err != nil {
		t.Fatal(err)
	}
	if err := SetPublishAccess(PublishAccess{{ID: fixture.box.ID, Disable: true, Visible: false}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ListDocTreeRange(context.Background(), fixture.box.ID, "", 0, 1, "", access); err == nil {
		t.Fatal("revoked policy reused between request admission and range construction")
	}
}

func TestDocTreeRangeContentEditDependencies(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	modes := []int{util.SortModeCustom, util.SortModeNameASC, util.SortModeUpdatedASC, util.SortModeSizeASC, util.SortModeRefCountASC}
	revisions := map[int]string{}
	for _, mode := range modes {
		Conf.FileTree.Load().Sort = mode
		batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, "", DocTreeAccess{})
		if err != nil {
			t.Fatal(err)
		}
		revisions[mode] = batch.Revision
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("updated", "20261026010000")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("A changed document body")})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	for _, mode := range modes {
		Conf.FileTree.Load().Sort = mode
		batch, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, revisions[mode], DocTreeAccess{})
		wantStale := mode == util.SortModeUpdatedASC || mode == util.SortModeSizeASC
		if err != nil || batch.Stale != wantStale {
			t.Fatalf("body edit, sort %d: %+v, %v", mode, batch, err)
		}
	}
	for _, attr := range []string{DocSortModeAttr, DocHiddenAttr} {
		Conf.FileTree.Load().Sort = util.SortModeCustom
		before, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, "", DocTreeAccess{})
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr(attr, map[string]string{DocSortModeAttr: "0", DocHiddenAttr: "true"}[attr])
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		after, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 10, before.Revision, DocTreeAccess{})
		if err != nil || !after.Stale {
			t.Fatalf("%s change retained directory: %+v, %v", attr, after, err)
		}
	}
}

func TestDocTreeRangeRichTitleSortAndLocate(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	Conf.FileTree.Load().Sort = util.SortModeNameASC
	before, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 1, "", DocTreeAccess{})
	if err != nil || len(before.Files) != 1 || before.Files[0].ID != fixture.sourceID {
		t.Fatalf("initial title order: %+v, %v", before, err)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	const title = "Zeta / literal.sy"
	paragraph := parse.Parse("", []byte("**"+title+"**"), util.NewLute().ParseOptions).Root.FirstChild
	if err = treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	stale, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 1, before.Revision, DocTreeAccess{})
	if err != nil || !stale.Stale || stale.Revision == before.Revision || len(stale.Files) != 0 {
		t.Fatalf("rich title change retained cached order: %+v, %v", stale, err)
	}
	after, err := ListDocTreeRange(ctx, fixture.box.ID, "", 1, 1, "", DocTreeAccess{})
	if err != nil || len(after.Files) != 1 || after.Files[0].ID != fixture.sourceID ||
		after.Files[0].Name != title || after.Files[0].Path != fixture.sourcePath {
		t.Fatalf("rich title range changed literal text or identity: %+v, %v", after, err)
	}
	steps, err := LocateDocTreeItem(ctx, fixture.box.ID, fixture.sourceID, DocTreeAccess{})
	if err != nil || len(steps) != 1 || steps[0].Index != 1 || steps[0].Revision != after.Revision {
		t.Fatalf("rich title location did not follow reordered siblings: %+v, %v", steps, err)
	}
}

func TestDocTreeBatchMigration(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want int
	}{
		{`{"confVersion":6,"fileTree":{"maxListCount":2048}}`, 2048},
		{`{"confVersion":6,"fileTree":{"maxListCount":0}}`, 512},
		{`{"confVersion":6}`, 512},
		{`{"confVersion":6,"fileTree":{"maxListCount":2048,"docTreeBatchSize":32}}`, 32},
		{`{"confVersion":6,"fileTree":{"maxListCount":2048,"docTreeBatchSize":null}}`, 512},
	} {
		value := NewAppConf()
		if err := json.Unmarshal([]byte(test.raw), value); err != nil {
			t.Fatal(err)
		}
		applyConfMigrations(value, []byte(test.raw))
		normalized := conf.NormalizeFileTree(value.FileTree.Load())
		if *normalized.DocTreeBatchSize != test.want {
			t.Fatalf("%s: got %d, want %d", test.raw, *normalized.DocTreeBatchSize, test.want)
		}
		if applyConfMigrations(value, []byte(test.raw)) {
			t.Fatal("migration repeated")
		}
	}
}

func TestDocTreeRangeLargeDataset(t *testing.T) {
	fixture := setupFileOperationTest(t)
	count := 10000
	if configured, err := strconv.Atoi(os.Getenv("SIYUAN_TEST_DOC_TREE_SIZE")); err == nil && configured >= 10000 && configured <= 100000 {
		count = configured
	}
	var target string
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("20260718050000-%07d", index)
		data, err := json.Marshal(map[string]interface{}{"ID": id, "Type": "NodeDocument", "Spec": "1",
			"Properties": map[string]string{"id": id, "title": fmt.Sprintf("Item %d", index), "updated": "20260718050000"}})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(util.DataDir, fixture.box.ID, id+".sy"), data, 0600); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			target = id
			treenode.UpsertBlockTree(treenode.NewTree(fixture.box.ID, "/"+id+".sy", "/Item 0", "Item 0"))
		}
	}
	cache.InvalidateDocTree(fixture.box.ID)
	ctx := context.Background()
	started := time.Now()
	first, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 512, "", DocTreeAccess{})
	cold := time.Since(started)
	if err != nil || first.Total != count+2 {
		t.Fatalf("large initial range: %+v, %v", first, err)
	}
	seen := map[string]bool{}
	started = time.Now()
	for offset := 0; offset < first.Total; offset += 512 {
		batch, readErr := ListDocTreeRange(ctx, fixture.box.ID, "", offset, 512, first.Revision, DocTreeAccess{})
		if readErr != nil || batch.Stale {
			t.Fatalf("large range %d: %+v, %v", offset, batch, readErr)
		}
		for _, file := range batch.Files {
			if seen[file.ID] {
				t.Fatalf("duplicate document %s", file.ID)
			}
			seen[file.ID] = true
		}
	}
	hot := time.Since(started)
	if len(seen) != count+2 {
		t.Fatalf("missing documents: %d", len(seen))
	}
	started = time.Now()
	steps, err := LocateDocTreeItem(ctx, fixture.box.ID, target, DocTreeAccess{})
	locate := time.Since(started)
	if err != nil || len(steps) != 1 || steps[0].Index != count-1 {
		t.Fatalf("large target location: %+v, %v", steps, err)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("updated", "20261026010000")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("A changed document body")})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	started = time.Now()
	edited, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 512, first.Revision, DocTreeAccess{})
	contentEditHot := time.Since(started)
	if err != nil || edited.Stale || edited.Revision != first.Revision {
		t.Fatalf("content edit invalidated independent order: %+v, %v", edited, err)
	}
	cache.InvalidateDocTree(fixture.box.ID)
	started = time.Now()
	changed, err := ListDocTreeRange(ctx, fixture.box.ID, "", 0, 512, first.Revision, DocTreeAccess{})
	rebuild := time.Since(started)
	if err != nil || !changed.Stale || len(changed.Files) != 0 {
		t.Fatalf("large invalidation: %+v, %v", changed, err)
	}
	t.Logf("documents=%d batch=512 cold=%s all-cached-ranges=%s cached-locate=%s after-content-edit=%s invalidated-rebuild=%s", count+2, cold, hot, locate, contentEditHot, rebuild)
}
