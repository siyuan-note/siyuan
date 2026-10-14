package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func assertSortConfBackup(t *testing.T, boxID string, original []byte) {
	t.Helper()
	backups, err := filepath.Glob(filepath.Join(util.WorkspaceDir, "corrupted", "*-sort-*", boxID, ".siyuan", "sort.json"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("expected one original backup, got %v, %v", backups, err)
	}
	data, err := os.ReadFile(backups[0])
	if err != nil || !bytes.Equal(data, original) {
		t.Fatalf("original sort config was not preserved: %q, %v", data, err)
	}
}

func TestSortConfRecoveryPreservesIntegerEntries(t *testing.T) {
	f := setupFileOperationTest(t)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	confPath := filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json")
	bad := []byte(`{"` + f.sourceID + `":7,"` + f.targetID + `":-2,"string":"4","null":null,"fraction":1.5,"object":{},"overflow":999999999999999999999}`)
	if err := os.WriteFile(confPath, bad, 0644); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{f.sourceID: 7, f.targetID: -2}
	for range 2 {
		actual, err := readSortConfMap(confPath)
		if err != nil || !reflect.DeepEqual(actual, want) {
			t.Fatalf("valid sort entries lost: %v, %v", actual, err)
		}
	}
	assertSortConfBackup(t, f.box.ID, bad)
}

func TestSortConfRecoveryBackupFailurePreservesSource(t *testing.T) {
	f := setupFileOperationTest(t)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	if err := os.WriteFile(filepath.Join(util.WorkspaceDir, "corrupted"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(util.DataDir, f.box.ID, ".siyuan", "sort.json")
	bad := []byte(`{"ID":"sort.json","Type":"NodeDocument"}`)
	if err := os.WriteFile(confPath, bad, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readSortConfMap(confPath); err == nil {
		t.Fatal("backup failure was ignored")
	}
	actual, err := os.ReadFile(confPath)
	if err != nil || !bytes.Equal(actual, bad) {
		t.Fatalf("backup failure changed source: %q, %v", actual, err)
	}
}

func TestSortConfRecoveryUsesValidSnapshot(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	const boxID = "20261008000000-sortbox"
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"20261008000001-sortdoc": 5, "20261008000002-sortdoc": 2}
	if err := writeSortConfMap(confPath, want); err != nil {
		t.Fatal(err)
	}
	valid, err := repo.Index("valid sort", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"20261008000001-sortdoc":99,"Type":"NodeDocument"}`)
	if err = os.WriteFile(confPath, bad, 0644); err != nil {
		t.Fatal(err)
	}
	when := time.Now().Add(time.Second)
	if err = os.Chtimes(confPath, when, when); err != nil {
		t.Fatal(err)
	}
	invalid, err := repo.Index("corrupt sort", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	for id, stamp := range map[string]int64{valid.ID: 1000, invalid.ID: 2000} {
		when := time.Unix(stamp, 0)
		if err = os.Chtimes(filepath.Join(util.RepoDir, "indexes", id), when, when); err != nil {
			t.Fatal(err)
		}
	}
	actual, err := readSortConfMap(confPath)
	if err != nil || !reflect.DeepEqual(actual, want) {
		t.Fatalf("did not prefer a valid snapshot: %v, %v", actual, err)
	}
	assertSortConfBackup(t, boxID, bad)
}

func TestSortConfRecoveryRejectsBrokenSnapshot(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	const boxID = "20261008000000-sortbox"
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeSortConfMap(confPath, map[string]int{"20261008000001-sortdoc": 3}); err != nil {
		t.Fatal(err)
	}
	_, err := repo.Index("sort snapshot", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.RepoDir, "indexes", "ffffffffffffffffffffffffffffffffffffffff"), []byte("invalid authenticated snapshot"), 0600); err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"20261008000001-sortdoc":7,"Type":"NodeDocument"}`)
	if err = os.WriteFile(confPath, bad, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = readSortConfMap(confPath); err == nil {
		t.Fatal("unreadable authenticated snapshot was treated as unavailable")
	}
	actual, err := os.ReadFile(confPath)
	if err != nil || !bytes.Equal(actual, bad) {
		t.Fatalf("snapshot failure changed original config: %q, %v", actual, err)
	}
	assertSortConfBackup(t, boxID, bad)
}
