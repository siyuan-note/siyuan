package model

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func resetMemoryEventQueues(t *testing.T) {
	t.Helper()
	clear := func() {
		memorySourceQueue.Lock()
		if memorySourceQueue.timer != nil {
			memorySourceQueue.timer.Stop()
		}
		memorySourceQueue.timer = nil
		memorySourceQueue.ids = map[string]bool{}
		memorySourceQueue.workspace = ""
		memorySourceQueue.Unlock()
		memoryDatabaseQueue.Lock()
		if memoryDatabaseQueue.timer != nil {
			memoryDatabaseQueue.timer.Stop()
		}
		memoryDatabaseQueue.timer = nil
		memoryDatabaseQueue.ids = map[string]bool{}
		memoryDatabaseQueue.workspace = ""
		memoryDatabaseQueue.Unlock()
	}
	clear()
	t.Cleanup(clear)
}

func TestAIMemoryDatabaseChangesUseWrittenJournal(t *testing.T) {
	id := "20261029000000-abcdefg"
	file := func(kind, box, name, before, after string) *documentSourceFile {
		return &documentSourceFile{Kind: kind, Box: box, Path: name, Before: []byte(before), After: []byte(after)}
	}
	tx := &Transaction{sourceDatabaseBefore: map[string]*documentSourceFile{
		"changed":   file("database", "", "/storage/av/"+id+".json", "old", "new"),
		"unchanged": file("database", "", "/storage/av/20261029000001-abcdefg.json", "same", "same"),
		"encrypted": file("database", "20261029000002-abcdefg", "/storage/av/20261029000003-abcdefg.json", "old", "new"),
		"other":     file("relations", "", "/storage/av/relations.msgpack", "old", "new"),
		"invalid":   file("database", "", "/storage/av/../secret.json", "old", "new"),
	}}
	if got := tx.memoryChangedDatabaseIDs(); !reflect.DeepEqual(got, []string{id}) {
		t.Fatalf("unexpected database changes: %v", got)
	}
}

func TestAIMemoryDatabaseChangeTargetsExistingSources(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	store := memo.NewStore(dir)
	databaseID := "20261029000000-abcdefg"
	wantSource := "20261029000001-abcdefg"
	for i := 0; i < 103; i++ {
		sourceID := fmt.Sprintf("20261029000001-%07d", i)
		state, evidence := "active", `{"databases":[{"id":"unrelated"}]}`
		if i >= 100 {
			evidence = `{"databases":[{"id":"` + databaseID + `"}]}`
			sourceID = wantSource
		}
		if i == 102 {
			state, sourceID = "disabled", "20261029000002-abcdefg"
		}
		r := memo.Record{ID: fmt.Sprintf("20261029000000-%07d", i), Kind: "fact", Subject: "project", Scope: "workspace", State: state, Content: "fact",
			Sources: []memo.Source{{Kind: "block", ID: sourceID, Revision: "previous", Evidence: evidence}}}
		if _, err := store.Save(ctx, r, "missing", fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := memoryDatabaseSourceIDs(ctx, dir, map[string]bool{databaseID: true})
	if err != nil || !reflect.DeepEqual(got, []string{wantSource}) {
		t.Fatalf("targeted paginated scan: %v %v", got, err)
	}
}

func TestAIMemoryAffectedSourcesStayWithinChangedRoots(t *testing.T) {
	fixture := setupFileOperationTest(t)
	ctx := context.Background()
	store := memo.NewStore(util.DataDir)
	other := treenode.NewTree("20261029000009-abcdefg", "/20261029000008-abcdefg.sy", "/Other", "Other")
	treenode.UpsertBlockTree(other)
	for i := 0; i < 103; i++ {
		sourceID := fixture.targetID
		if i == 100 {
			sourceID = fixture.childID
		} else if i == 101 {
			sourceID = other.Root.FirstChild.ID
		}
		r := memo.Record{ID: fmt.Sprintf("20261029000000-%07d", i), Kind: "fact", Subject: "project", Scope: "workspace", State: "active", Content: "fact",
			Sources: []memo.Source{{Kind: "block", ID: sourceID, Revision: "previous"}}}
		if _, err := store.Save(ctx, r, "missing", fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{fixture.sourceID, fixture.childID}
	sort.Strings(want)
	got, err := memoryAffectedSourceIDs(ctx, util.DataDir, []string{fixture.sourceID})
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("root expansion crossed source boundary or missed page: %v %v", got, err)
	}
	got, err = memoryAffectedSourceIDs(ctx, util.DataDir, []string{fixture.childID})
	if err != nil || !reflect.DeepEqual(got, []string{fixture.childID}) {
		t.Fatalf("subtree change unexpectedly expanded scope: %v %v", got, err)
	}
}

func TestAIMemorySyncQueuesDatabaseOnlyChanges(t *testing.T) {
	setupAIMemoryTest(t)
	resetMemoryEventQueues(t)
	id := "20261029000000-abcdefg"
	removed := "20261029000001-abcdefg"
	memorySyncSourcesChanged(&dejavu.MergeResult{
		Upserts: []*entity.File{{Path: "/storage/av/" + id + ".json"}, {Path: "/storage/av/relations.msgpack"}, {Path: "/box/storage/av/20261029000002-abcdefg.json"}},
		Removes: []*entity.File{{Path: "/storage/av/" + removed + ".json"}},
	})
	memoryDatabaseQueue.Lock()
	defer memoryDatabaseQueue.Unlock()
	if len(memoryDatabaseQueue.ids) != 2 || !memoryDatabaseQueue.ids[id] || !memoryDatabaseQueue.ids[removed] {
		t.Fatalf("database sync notifications: %v", memoryDatabaseQueue.ids)
	}
}
