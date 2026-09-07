package model

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocTreeReorderConflictAndCompleteOrder(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeNameASC
	Conf.FileTree.MaxListCount = 1
	hidden := addFileOperationTestDoc(t, f, "20260718000003-abcdefg", "Hidden", true)
	unlisted := addFileOperationTestDoc(t, f, "20260718000004-abcdefg", "Unlisted", false)
	confPath := filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json")
	initial := map[string]int{unlisted.ID: 1, f.targetID: 2, f.sourceID: 3, hidden.ID: 4}
	if err := writeSortConfMap(confPath, initial); err != nil {
		t.Fatal(err)
	}
	for _, preview := range []bool{true, false} {
		result, err := ReorderDocTree([]string{f.targetID}, f.sourceID, "before", preview, false)
		if err != nil || !result.Conflict || !result.Changed {
			t.Fatalf("unexpected conflict preview: %+v, %v", result, err)
		}
		actual, err := readSortConfMap(confPath)
		if err != nil || !reflect.DeepEqual(actual, initial) {
			t.Fatalf("unconfirmed move changed custom order: %v, %v", actual, err)
		}
		mode, err := ResolveDocTreeSortMode(f.box.ID, "/")
		if err != nil || mode != util.SortModeNameASC {
			t.Fatalf("unconfirmed move changed mode: %d, %v", mode, err)
		}
	}
	result, err := ReorderDocTree([]string{f.targetID}, f.sourceID, "before", false, true)
	if err != nil || !result.Changed {
		t.Fatalf("confirmed move failed: %+v, %v", result, err)
	}
	assertSiblingCustomOrder(t, f.box.ID, "/", []string{hidden.ID, f.targetID, f.sourceID, unlisted.ID})
	mode, err := ResolveDocTreeSortMode(f.box.ID, "/")
	if err != nil || mode != util.SortModeCustom || Conf.FileTree.Sort != util.SortModeNameASC {
		t.Fatalf("confirmation did not set only notebook mode: %d, %v", mode, err)
	}
}

func TestDocTreeReorderEqualValuesPersist(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeSubDocCountASC
	result, err := ReorderDocTree([]string{f.sourceID}, f.targetID, "before", false, false)
	if err != nil || result.Conflict || !result.Changed {
		t.Fatalf("equal-value move failed: %+v, %v", result, err)
	}
	files, _, err := ListDocTree(f.box.ID, "/", util.SortModeUnassigned, false, true, 100)
	if err != nil || len(files) != 2 || files[0].ID != f.sourceID || files[1].ID != f.targetID {
		t.Fatalf("manual tie order was not displayed: %+v, %v", files, err)
	}
	mode, err := ResolveDocTreeSortMode(f.box.ID, "/")
	if err != nil || mode != util.SortModeSubDocCountASC {
		t.Fatalf("equal-value move changed sort rule: %d, %v", mode, err)
	}
	result, err = ReorderDocTree([]string{f.sourceID}, f.targetID, "before", false, false)
	if err != nil || result.Changed {
		t.Fatalf("repeated move should be a no-op: %+v, %v", result, err)
	}
}

func TestDocTreeReorderRejectsUnreadableSort(t *testing.T) {
	f := setupFileOperationTest(t)
	confPath := filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json")
	bad := []byte("invalid sort data")
	if err := os.WriteFile(confPath, bad, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReorderDocTree([]string{f.sourceID}, f.targetID, "before", false, true); err == nil {
		t.Fatal("invalid sort data was accepted")
	}
	actual, err := os.ReadFile(confPath)
	if err != nil || string(actual) != string(bad) {
		t.Fatalf("invalid sort data was overwritten: %s, %v", actual, err)
	}
}

func TestDocTreeSortAllModesRespectTies(t *testing.T) {
	for mode := util.SortModeNameASC; mode <= util.SortModeSubDocCountDESC; mode++ {
		left := &File{ID: "20260718000001-abcdefg", Name: "Same", Sort: 1}
		right := &File{ID: "20260718000002-abcdefg", Name: "Same", Sort: 2}
		docs := []*File{right, left}
		sortDocTreeFiles(docs, mode)
		if docs[0] != left || fileTreeSortLess(left, right, mode) || fileTreeSortLess(right, left, mode) {
			t.Fatalf("mode %d did not preserve manual tie order", mode)
		}
	}
}

func TestDocTreeReorderCrossParentPreviewDoesNotMove(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeNameASC
	childPath := "/" + f.sourceID + "/20260718000003-abcdefg.sy"
	child := treenode.NewTree(f.box.ID, childPath, "/Source/A", "A")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(child)
	t.Cleanup(func() {
		cache.RemoveTreeData(child.ID)
		cache.RemoveDocIAL(child.Path)
	})
	for _, preview := range []bool{true, false} {
		result, err := ReorderDocTree([]string{f.targetID}, child.ID, "before", preview, false)
		if err != nil || !result.Conflict || result.ParentPath != f.sourcePath {
			t.Fatalf("unexpected inherited sort preview: %+v, %v", result, err)
		}
		if source := treenode.GetBlockTree(f.targetID); source == nil || source.Path != f.targetPath {
			t.Fatalf("unconfirmed cross-parent drag moved the source: %+v", source)
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, f.box.ID, f.targetPath)); err != nil {
			t.Fatalf("source file was moved: %v", err)
		}
	}
}

func TestDocTreeReorderMultipleSourcesKeepSelectionOrder(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeNameASC
	extra := addFileOperationTestDoc(t, f, "20260718000003-abcdefg", "Z", false)
	result, err := ReorderDocTree([]string{extra.ID, f.targetID}, f.sourceID, "before", false, true)
	if err != nil || !result.Conflict {
		t.Fatalf("multi-document reorder failed: %+v, %v", result, err)
	}
	assertSiblingCustomOrder(t, f.box.ID, "/", []string{extra.ID, f.targetID, f.sourceID})
}

func TestDocTreeReorderInheritsCustomPanelSort(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeCustom
	boxConf := f.box.GetConf()
	boxConf.SortMode = util.SortModeNameASC
	if err := f.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	result, err := ReorderDocTree([]string{f.targetID}, f.sourceID, "before", false, true)
	if err != nil || !result.Conflict {
		t.Fatalf("reorder failed: %+v, %v", result, err)
	}
	if mode := f.box.GetConf().SortMode; mode != util.SortModeFileTree {
		t.Fatalf("expected panel inheritance, got %d", mode)
	}
	assertSiblingCustomOrder(t, f.box.ID, "/", []string{f.targetID, f.sourceID})
	Conf.FileTree.Sort = util.SortModeCreatedASC
	if mode, err := ResolveDocTreeSortMode(f.box.ID, "/"); err != nil || mode != util.SortModeCreatedASC {
		t.Fatalf("notebook did not follow later panel changes: %d, %v", mode, err)
	}
}

func TestDraggedDocSortModeUsesParentInheritance(t *testing.T) {
	f := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeNameASC
	parent, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	childPath := "/" + f.sourceID + "/20260718000003-abcdefg.sy"
	for _, parentMode := range []int{util.SortModeCustom, util.SortModeUpdatedDESC} {
		parent.Root.SetIALAttr(DocSortModeAttr, strconv.Itoa(parentMode))
		if _, err = filesys.WriteTree(parent); err != nil {
			t.Fatal(err)
		}
		cache.RemoveDocIALInBox(parent.Path, parent.Box)
		mode, err := resolveDraggedDocSortMode(f.box.ID, childPath)
		if err != nil {
			t.Fatal(err)
		}
		if parentMode == util.SortModeCustom {
			if mode != nil {
				t.Fatalf("expected parent inheritance, got %d", *mode)
			}
		} else if mode == nil || *mode != util.SortModeCustom {
			t.Fatalf("expected explicit custom sort, got %v", mode)
		}
	}
	boxConf := f.box.GetConf()
	boxConf.SortMode = util.SortModeCustom
	if err = f.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if mode, err := resolveDraggedDocSortMode(f.box.ID, f.sourcePath); err != nil || mode != nil {
		t.Fatalf("expected notebook inheritance despite the document override: %v, %v", mode, err)
	}
}
