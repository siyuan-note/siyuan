package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSnapshotMemoDefaults(t *testing.T) {
	for _, memo := range []string{"", " \n\t", "\u200b\u200c"} {
		if got := normalizeSnapshotMemo(memo); got != "Create manually" {
			t.Fatalf("default for %q: %q", memo, got)
		}
	}
	if got := normalizeSnapshotMemo("  hello\n备注  "); got != "hello备注" {
		t.Fatalf("memo lost: %q", got)
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
	if err = SetRepoSnapshotMemo(id, "edited"); err != nil {
		t.Fatal(err)
	}
	changed, err = CheckRepoSnapshot()
	if err != nil || changed {
		t.Fatalf("memo edit changed source data: changed=%v err=%v", changed, err)
	}
}
