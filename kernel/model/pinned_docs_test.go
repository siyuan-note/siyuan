package model

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPinnedDocsOrderIsIndependent(t *testing.T) {
	f := setupFileOperationTest(t)
	before, _, err := ListDocTree(f.box.ID, "/", util.SortModeNameASC, false, true, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{f.sourceID, f.targetID, f.sourceID} {
		if err = UpdatePinnedDocs([]string{id}, "pin", "", false); err != nil {
			t.Fatal(err)
		}
	}
	stored, err := readPinnedDocs()
	if err != nil || len(stored.Docs) != 2 || stored.Docs[0].ID != f.sourceID {
		t.Fatalf("unexpected pins: %+v, %v", stored, err)
	}
	if err = UpdatePinnedDocs([]string{f.sourceID}, "pin", f.targetID, true); err != nil {
		t.Fatal(err)
	}
	stored, _ = readPinnedDocs()
	if stored.Docs[0].ID != f.targetID {
		t.Fatal("relative reorder failed")
	}
	if err = UpdatePinnedDocs([]string{f.targetID}, "unpin", "", false); err != nil {
		t.Fatal(err)
	}
	stored, _ = readPinnedDocs()
	if len(stored.Docs) != 1 || stored.Docs[0].ID != f.sourceID {
		t.Fatal("unpin removed another entry")
	}
	after, _, err := ListDocTree(f.box.ID, "/", util.SortModeNameASC, false, true, 100)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("pinning changed source tree: %v", err)
	}
	if !PathsAffectSync(filepath.Join(util.DataDir, "storage", "pinned-docs.json")) {
		t.Fatal("pinned documents are not synchronized")
	}
}

func TestPinnedDocsPreserveInvalidStorage(t *testing.T) {
	f := setupFileOperationTest(t)
	file := filepath.Join(util.DataDir, "storage", "pinned-docs.json")
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{`{`, `null`, `{"version":2,"docs":[]}`, `{"docs":[]}`, `{"version":1,"docs":[{"id":"../bad","notebook":"bad"}]}`} {
		if err := os.WriteFile(file, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := GetPinnedDocs(); err == nil {
			t.Fatalf("accepted invalid storage: %s", data)
		}
		if err := UpdatePinnedDocs([]string{f.sourceID}, "pin", "", false); err == nil {
			t.Fatal("overwrote invalid storage")
		}
		actual, _ := os.ReadFile(file)
		if string(actual) != data {
			t.Fatal("original storage changed")
		}
	}
}

func TestPinnedDocsValidateAndMaintainReferences(t *testing.T) {
	f := setupFileOperationTest(t)
	if err := UpdatePinnedDocs([]string{f.sourceID}, "pin", "", false); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{{}, {"invalid"}, {f.targetID, "20260913000000-abcdefg"}} {
		if err := UpdatePinnedDocs(ids, "pin", "", false); err == nil {
			t.Fatal("invalid batch accepted")
		}
	}
	stored, _ := readPinnedDocs()
	if len(stored.Docs) != 1 {
		t.Fatal("failed batch changed pins")
	}
	docs, err := GetPinnedDocs()
	if err != nil || len(docs) != 1 || docs[0].ID != f.sourceID || docs[0].Path == "" {
		t.Fatalf("cannot resolve pin: %+v, %v", docs, err)
	}
	maintainPinnedDocs(map[string]bool{f.sourceID: true}, "", "20260913000001-abcdefg")
	stored, _ = readPinnedDocs()
	if stored.Docs[0].Notebook != "20260913000001-abcdefg" {
		t.Fatal("move did not update notebook")
	}
	maintainPinnedDocs(nil, "20260913000001-abcdefg", "")
	stored, _ = readPinnedDocs()
	if len(stored.Docs) != 0 {
		t.Fatal("deleted notebook retained pins")
	}
}

func TestPinnedDocsClosedAndEncryptedNotebook(t *testing.T) {
	f := setupFileOperationTest(t)
	originalLangs := util.Langs
	util.Langs = map[string]map[int]string{Conf.Lang: {396: "加密笔记本不支持置顶文档"}}
	t.Cleanup(func() { util.Langs = originalLangs })
	t.Cleanup(func() { forgetRuntimeEncryptedBox(f.box.ID); forgetRuntimeNormalBox(f.box.ID) })
	if err := UpdatePinnedDocs([]string{f.sourceID}, "pin", "", false); err != nil {
		t.Fatal(err)
	}
	boxConf := f.box.GetConf()
	boxConf.Closed = true
	if err := f.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	docs, err := GetPinnedDocs()
	if err != nil || len(docs) != 1 || !docs[0].Unavailable {
		t.Fatalf("closed notebook lost pin: %+v, %v", docs, err)
	}
	boxConf.Encrypted = true
	forgetRuntimeNormalBox(f.box.ID)
	if err := f.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	forgetRuntimeNormalBox(f.box.ID)
	if err := UpdatePinnedDocs([]string{f.sourceID}, "pin", "", false); err == nil || err.Error() != "加密笔记本不支持置顶文档" {
		t.Fatalf("expected localized encrypted notebook error, got %v", err)
	}
	docs, err = GetPinnedDocs()
	if err != nil || len(docs) != 0 {
		t.Fatalf("encrypted document exposed: %+v, %v", docs, err)
	}
}

func TestPinnedDocsSupportNotebookRoot(t *testing.T) {
	f := setupFileOperationTest(t)
	addFileOperationTestDoc(t, f, "20260718000005-abcdefg", "Hidden", true)
	root := treenode.NewTree(f.box.ID, "/"+f.box.ID+".sy", "/Notebook", "Notebook")
	root.Root.SetIALAttr(DocHiddenAttr, "true")
	if _, err := filesys.WriteTree(root); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(root)
	t.Cleanup(func() { cache.RemoveTreeData(root.ID); cache.RemoveDocIAL(root.Path) })
	if err := UpdatePinnedDocs([]string{root.ID}, "pin", "", false); err != nil {
		t.Fatal(err)
	}
	docs, err := GetPinnedDocs()
	if err != nil || len(docs) != 1 {
		t.Fatalf("notebook root missing: %+v, %v", docs, err)
	}
	if docs[0].ID != root.ID || docs[0].Path != root.Path || docs[0].SubFileCount != 2 {
		t.Fatalf("incorrect root document or child count: %+v", docs[0])
	}
	if isSortableDocument(treenode.GetBlockTree(root.ID)) {
		t.Fatal("pinning changed source sorting eligibility")
	}
	if err := UpdatePinnedDocs([]string{f.childID}, "pin", "", false); err == nil {
		t.Fatal("non-document block accepted")
	}
	if err := UpdatePinnedDocs([]string{root.ID}, "unpin", "", false); err != nil {
		t.Fatal(err)
	}
	docs, err = GetPinnedDocs()
	if err != nil || len(docs) != 0 {
		t.Fatalf("notebook root unpin failed: %+v, %v", docs, err)
	}
}

func TestPinnedDocsHiddenVisibilityAndCounts(t *testing.T) {
	f := setupFileOperationTest(t)
	parent := addFileOperationTestDoc(t, f, "20260718000003-abcdefg", "Parent", false)
	child := treenode.NewTree(f.box.ID, "/"+parent.ID+"/20260718000004-abcdefg.sy", "/Parent/Child", "Child")
	writeChild := func() {
		t.Helper()
		if _, err := filesys.WriteTree(child); err != nil {
			t.Fatal(err)
		}
		cache.RemoveDocIAL(child.Path)
	}
	writeChild()
	t.Cleanup(func() { cache.RemoveTreeData(child.ID); cache.RemoveDocIAL(child.Path) })
	if err := UpdatePinnedDocs([]string{parent.ID}, "pin", "", false); err != nil {
		t.Fatal(err)
	}
	for _, hidden := range []bool{false, true, false} {
		if hidden {
			child.Root.SetIALAttr(DocHiddenAttr, "true")
		} else {
			child.Root.RemoveIALAttr(DocHiddenAttr)
		}
		writeChild()
		docs, err := GetPinnedDocs()
		children, _, listErr := ListDocTree(f.box.ID, "/"+parent.ID, util.SortModeNameASC, false, false, 100)
		want := 1
		if hidden {
			want = 0
		}
		if len(children) != want {
			t.Fatalf("expected %d visible children, got %d", want, len(children))
		}
		if err != nil || listErr != nil || len(docs) != 1 || docs[0].SubFileCount != len(children) {
			t.Fatalf("pin count differs from visible children: %+v, %v, %v", docs, err, listErr)
		}
		top, _, err := ListDocTree(f.box.ID, "/", util.SortModeNameASC, false, false, 100)
		if err != nil {
			t.Fatal(err)
		}
		for _, doc := range top {
			if doc.ID == parent.ID && doc.SubFileCount != len(children) {
				t.Fatalf("source count differs from pin: %+v", doc)
			}
		}
	}
	storagePath := filepath.Join(util.DataDir, "storage", "pinned-docs.json")
	before, _ := os.ReadFile(storagePath)
	for _, hidden := range []bool{true, false} {
		if hidden {
			parent.Root.SetIALAttr(DocHiddenAttr, "true")
		} else {
			parent.Root.RemoveIALAttr(DocHiddenAttr)
		}
		if _, err := filesys.WriteTree(parent); err != nil {
			t.Fatal(err)
		}
		cache.RemoveDocIAL(parent.Path)
		docs, err := GetPinnedDocs()
		if err != nil || hidden && len(docs) != 0 || !hidden && len(docs) != 1 {
			t.Fatalf("unexpected hidden pin visibility: %+v, %v", docs, err)
		}
		if hidden && UpdatePinnedDocs([]string{parent.ID}, "pin", "", false) == nil {
			t.Fatal("hidden document accepted for pinning")
		}
		top, _, err := ListDocTree(f.box.ID, "/", util.SortModeNameASC, false, false, 100)
		if err != nil || BoxDocSubFileCount(f.box.ID) != len(top) {
			t.Fatalf("notebook count differs: %v", err)
		}
		after, _ := os.ReadFile(storagePath)
		if string(before) != string(after) {
			t.Fatal("visibility changed stored pins")
		}
	}
}
