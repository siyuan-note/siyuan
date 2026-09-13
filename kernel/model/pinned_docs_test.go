package model

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

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
	if err := UpdatePinnedDocs([]string{f.sourceID}, "pin", "", false); err == nil {
		t.Fatal("encrypted document accepted")
	}
	docs, err = GetPinnedDocs()
	if err != nil || len(docs) != 0 {
		t.Fatalf("encrypted document exposed: %+v, %v", docs, err)
	}
}
