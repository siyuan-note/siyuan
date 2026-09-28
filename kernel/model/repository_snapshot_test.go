package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSearchRepoSnapshot(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	index, err := partial.Latest()
	if err != nil {
		t.Fatal(err)
	}
	listed, _, _, err := GetRepoSnapshots(1)
	if err != nil {
		t.Fatal(err)
	}
	if found, _, _, err := SearchRepoSnapshot(index.ID, true); err != nil || len(found) != 1 || len(found[0].Files) != len(index.Files) {
		t.Fatalf("snapshot file metadata missing: %v %v", found, err)
	}
	if _, _, _, err := SearchRepoSnapshot(index.ID[:7], true); err == nil {
		t.Fatal("file listing accepted an ambiguous snapshot prefix")
	}
	for _, id := range []string{index.ID, index.ID[:7], index.ID[:15], " \n" + strings.ToUpper(index.ID[:7]) + "\t", " \n" + strings.ToUpper(index.ID) + "\t"} {
		found, pages, total, searchErr := SearchRepoSnapshot(id, false)
		if searchErr != nil || len(found) != 1 || pages != 1 || total != 1 {
			t.Fatalf("search %q: %v %d %d %v", id, found, pages, total, searchErr)
		}
		var expected *Snapshot
		for _, item := range listed {
			if item.ID == index.ID {
				expected = item
			}
		}
		want, _ := json.Marshal(expected)
		got, _ := json.Marshal(found[0])
		if expected == nil || !bytes.Equal(want, got) {
			t.Fatalf("metadata mismatch: %s / %s", want, got)
		}
	}
	missing := strings.Repeat("0", 40)
	if found, pages, total, err := SearchRepoSnapshot(missing, false); err != nil || len(found) != 0 || pages != 0 || total != 0 {
		t.Fatalf("missing snapshot: %v %d %d %v", found, pages, total, err)
	}
	for _, id := range []string{"", "short", "abcdef", "abcdefg", "../../outside", strings.Repeat("z", 40), strings.Repeat("a", 41)} {
		if _, _, _, err := SearchRepoSnapshot(id, false); err == nil {
			t.Fatalf("invalid ID accepted: %q", id)
		}
	}
	store, err := dejavu.NewStore(util.RepoDir, Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	other := *index
	other.ID = index.ID[:7] + strings.Repeat("0", 33)
	other.Created = index.Created + 1000
	if err = store.PutIndex(&other); err != nil {
		t.Fatal(err)
	}
	if found, pages, total, searchErr := SearchRepoSnapshot(index.ID[:7], false); searchErr != nil || pages != 1 || total != 2 ||
		len(found) != 2 || found[0].ID != other.ID || found[1].ID != index.ID {
		t.Fatalf("shared prefix: %v %d %d %v", found, pages, total, searchErr)
	}
	corruptID := strings.Repeat("1", 40)
	dir, file := store.IndexAbsPath(corruptID)
	if err = os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	corrupt := []byte("corrupt snapshot index")
	if err = os.WriteFile(file, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = SearchRepoSnapshot(corruptID, false); err == nil {
		t.Fatal("corrupt snapshot returned as missing")
	}
	if _, _, _, err = SearchRepoSnapshot(corruptID[:7], false); err == nil {
		t.Fatal("corrupt snapshot prefix returned as missing")
	}
	if unchanged, err := os.ReadFile(file); err != nil || !bytes.Equal(unchanged, corrupt) {
		t.Fatal("corrupt source was modified")
	}
}

func TestSnapshotMemoDefaults(t *testing.T) {
	for _, memo := range []string{"", " \n\t", "\u200b\u200c"} {
		if got := normalizeSnapshotMemo(memo); got != "Create manually" {
			t.Fatalf("default for %q: %q", memo, got)
		}
	}
	for _, memo := range []string{"  hello\n\n备注  ", "  hello\r\n\r\n备注  ", "  hello\u200b\n\n备注  "} {
		if got := normalizeSnapshotMemo(memo); got != "hello\n\n备注" {
			t.Fatalf("memo lost for %q: %q", memo, got)
		}
	}
}

func TestSnapshotManualFlow(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	if err := os.WriteFile(filepath.Join(util.DataDir, "manual.txt"), []byte("manual"), 0644); err != nil {
		t.Fatal(err)
	}
	changed, err := CheckRepoSnapshot()
	if err != nil || !changed {
		t.Fatalf("check: changed=%v err=%v", changed, err)
	}
	id, created, err := CreateRepoSnapshot("")
	if err != nil || !created || id == "" {
		t.Fatalf("create: id=%s created=%v err=%v", id, created, err)
	}
	latest, err := partial.Latest()
	if err != nil || latest.Memo != "Create manually" {
		t.Fatalf("default memo: %v %v", latest, err)
	}
	id2, created, err := CreateRepoSnapshot("must not overwrite")
	if err != nil || created || id2 != id {
		t.Fatalf("unchanged: id=%s created=%v err=%v", id2, created, err)
	}
	if err = SetRepoSnapshotMemo(id, "edited\n\n备注"); err != nil {
		t.Fatal(err)
	}
	latest, err = partial.Latest()
	if err != nil || latest.Memo != "edited\n\n备注" {
		t.Fatalf("multiline memo: %v %v", latest, err)
	}
	changed, err = CheckRepoSnapshot()
	if err != nil || changed {
		t.Fatalf("memo edit changed source data: changed=%v err=%v", changed, err)
	}
}
