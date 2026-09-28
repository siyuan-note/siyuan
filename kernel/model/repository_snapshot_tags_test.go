package model

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRepoSnapshotTags(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	writeHistorySnapshotTestFile(t, filepath.Join(util.DataDir, "tagged.txt"), []byte("first"))
	index, err := repo.Index("tagged snapshot", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	query := func(want []string) {
		t.Helper()
		queries := []func() ([]*Snapshot, error){
			func() ([]*Snapshot, error) { result, _, _, err := GetRepoSnapshots(1); return result, err },
			func() ([]*Snapshot, error) {
				result, _, _, err := SearchRepoSnapshot(index.ID[:7], false)
				return result, err
			},
			func() ([]*Snapshot, error) {
				result, _, _, err := SearchRepoSnapshot(index.ID, true)
				return result, err
			},
		}
		for _, query := range queries {
			result, err := query()
			if err != nil || len(result) == 0 {
				t.Fatalf("unexpected tags: %+v, %v", result, err)
			}
			found := false
			for _, snapshot := range result {
				expected := []string{}
				if snapshot.ID == index.ID {
					found = true
					expected = want
				}
				if snapshot.Tags == nil || !slices.Equal(snapshot.Tags, expected) || snapshot.Tag != "" {
					t.Fatalf("snapshot %s: tags %v, tag %q", snapshot.ID, snapshot.Tags, snapshot.Tag)
				}
			}
			if !found {
				t.Fatal("missing tagged snapshot")
			}
		}
	}
	query([]string{})
	for _, tag := range []string{"first", "alias"} {
		if err := repo.AddTag(index.ID, tag); err != nil {
			t.Fatal(err)
		}
	}
	query([]string{"alias", "first"})
	tagged, err := GetTagSnapshots()
	if err != nil || len(tagged) != 2 || tagged[0].Tag == tagged[1].Tag {
		t.Fatalf("tag view must retain one row per tag: %+v, %v", tagged, err)
	}
	for _, snapshot := range tagged {
		if !slices.Equal(snapshot.Tags, []string{"alias", "first"}) {
			t.Fatalf("tag view lost aliases: %+v", snapshot)
		}
	}
	if err := repo.RemoveTag("first"); err != nil {
		t.Fatal(err)
	}
	query([]string{"alias"})
	if err := repo.RemoveTag("alias"); err != nil {
		t.Fatal(err)
	}
	query([]string{})
	corrupt := []byte("invalid-index-reference")
	tagPath := filepath.Join(util.RepoDir, "refs", "tags", "broken")
	writeHistorySnapshotTestFile(t, tagPath, corrupt)
	if _, _, _, err := GetRepoSnapshots(1); err == nil {
		t.Fatal("corrupt tags must not appear as untagged snapshots")
	}
	if _, _, _, err := SearchRepoSnapshot(index.ID, false); err == nil {
		t.Fatal("snapshot lookup must report corrupt tags")
	}
	if actual, err := os.ReadFile(tagPath); err != nil || !bytes.Equal(actual, corrupt) {
		t.Fatal("corrupt tag was modified")
	}
}
