package model

import (
	"bytes"
	"context"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

const historySnapshotDocID = "20260928100000-histdoc"
const historySnapshotBoxID = "20260928100000-histbox"

func historySnapshotData(title string) []byte {
	return []byte(`{"ID":"` + historySnapshotDocID + `","Spec":"2","Type":"NodeDocument","Properties":{"id":"` + historySnapshotDocID + `","title":"` + title + `"},"Children":[]}`)
}

func writeHistorySnapshotTestFile(t *testing.T, file string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func historySnapshotTestEntry(t *testing.T, data []byte) *DocHistorySnapshotEntry {
	t.Helper()
	rel := filepath.Join("history", "2026-09-28-100000-update", historySnapshotBoxID, historySnapshotDocID+".sy")
	writeHistorySnapshotTestFile(t, filepath.Join(util.WorkspaceDir, rel), data)
	return &DocHistorySnapshotEntry{Created: "1790560800", HistoryPath: filepath.ToSlash(rel), Snapshots: []*DocHistorySnapshot{}}
}

func TestDocHistorySnapshotsMatching(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	data := historySnapshotData("original")
	docPath := filepath.Join(util.DataDir, historySnapshotBoxID, historySnapshotDocID+".sy")
	writeHistorySnapshotTestFile(t, docPath, data)
	first, err := repo.Index("first memo", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	first.Created = 1000
	if err = repo.PutIndex(first); err != nil {
		t.Fatal(err)
	}
	for _, tag := range []string{"first", "alias"} {
		if err = repo.AddTag(first.ID, tag); err != nil {
			t.Fatal(err)
		}
	}
	writeHistorySnapshotTestFile(t, filepath.Join(util.DataDir, "unrelated.txt"), []byte("second"))
	second, err := repo.Index("second\nline", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	second.Created = 2000
	if err = repo.PutIndex(second); err != nil {
		t.Fatal(err)
	}
	if err = repo.AddTag(second.ID, "second"); err != nil {
		t.Fatal(err)
	}
	query := func(data []byte) *DocHistorySnapshotEntry {
		t.Helper()
		entry := historySnapshotTestEntry(t, data)
		if err := GetDocHistorySnapshots(context.Background(), historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err != nil {
			t.Fatal(err)
		}
		return entry
	}
	entry := query(data)
	if len(entry.Snapshots) != 2 || entry.Snapshots[0].ID != second.ID || entry.Snapshots[1].ID != first.ID ||
		strings.Join(entry.Snapshots[1].Tags, ",") != "alias,first" || entry.Snapshots[0].Memo != "second\nline" ||
		entry.Snapshots[0].FileID == "" {
		t.Fatalf("unexpected snapshot associations: %+v", entry.Snapshots)
	}
	versions, _, _, err := GetRepoDocHistory(historySnapshotDocID, 1)
	if err != nil || len(versions) != 1 || len(versions[0].Snapshots) != 2 {
		t.Fatalf("deduplicated repository version lost associations: %+v %v", versions, err)
	}
	if versions[0].Snapshots[0].ID != second.ID || versions[0].Snapshots[1].ID != first.ID ||
		strings.Join(versions[0].Snapshots[1].Tags, ",") != "alias,first" || versions[0].Snapshots[0].Memo != "second\nline" {
		t.Fatalf("repository snapshot metadata lost: %+v", versions[0].Snapshots)
	}
	unmatched := &RepoDocHistory{FileID: strings.Repeat("f", 40)}
	if err := attachRepoDocHistorySnapshots(repo, []*RepoDocHistory{unmatched}); err != nil || unmatched.Snapshots == nil || len(unmatched.Snapshots) != 0 {
		t.Fatalf("unmatched repository version must have an empty list: %+v %v", unmatched, err)
	}
	if len(query(historySnapshotData("different")).Snapshots) != 0 {
		t.Fatal("different document data matched")
	}
	if err = repo.SetSnapshotMemo(first.ID, "edited"); err != nil {
		t.Fatal(err)
	}
	if err = repo.RemoveTag("second"); err != nil {
		t.Fatal(err)
	}
	entry = query(data)
	if len(entry.Snapshots) != 1 || entry.Snapshots[0].Memo != "edited" {
		t.Fatal("tag deletion or memo edit was hidden by stale associations")
	}
	versions, _, _, err = GetRepoDocHistory(historySnapshotDocID, 1)
	if err != nil || len(versions) != 1 || len(versions[0].Snapshots) != 1 || versions[0].Snapshots[0].Memo != "edited" {
		t.Fatalf("repository history retained stale tags or memo: %+v %v", versions, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err = GetDocHistorySnapshots(ctx, historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err != context.Canceled {
		t.Fatalf("cancellation ignored: %v", err)
	}
	corrupt := []byte("invalid-index-reference")
	tagPath := filepath.Join(util.RepoDir, "refs", "tags", "broken")
	writeHistorySnapshotTestFile(t, tagPath, corrupt)
	if err = GetDocHistorySnapshots(context.Background(), historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err == nil {
		t.Fatal("corrupt tag was treated as no match")
	}
	if _, _, _, err = GetRepoDocHistory(historySnapshotDocID, 1); err == nil {
		t.Fatal("repository history ignored a corrupt tag")
	}
	if actual, err := os.ReadFile(tagPath); err != nil || !bytes.Equal(actual, corrupt) {
		t.Fatal("corrupt tag was modified")
	}
}

func TestDocHistorySnapshotsEncrypted(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	defer prepareEncryptedBoxLifecycleTest(t, historySnapshotBoxID)()
	setEncryptedBoxState(historySnapshotBoxID, EncryptedBoxStateUnlocked)
	dek, err := GetDEKIfUnlocked(historySnapshotBoxID)
	if err != nil {
		t.Fatal(err)
	}
	rel := "/" + historySnapshotDocID + ".sy"
	plain := historySnapshotData("secret")
	historyData, err := EncryptFile(historySnapshotBoxID, rel, dek, plain)
	if err != nil {
		t.Fatal(err)
	}
	snapshotData, err := EncryptFile(historySnapshotBoxID, rel, dek, plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(historyData, snapshotData) {
		t.Fatal("test requires different ciphertext for identical plaintext")
	}
	writeHistorySnapshotTestFile(t, filepath.Join(util.DataDir, historySnapshotBoxID, rel), snapshotData)
	repo, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("encrypted", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.AddTag(index.ID, "encrypted"); err != nil {
		t.Fatal(err)
	}
	entry := historySnapshotTestEntry(t, historyData)
	if err = GetDocHistorySnapshots(context.Background(), historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err != nil || len(entry.Snapshots) != 1 {
		t.Fatalf("authenticated match failed: %v %+v", err, entry.Snapshots)
	}
	bad := bytes.Clone(historyData)
	bad[len(bad)-1] ^= 1
	entry = historySnapshotTestEntry(t, bad)
	if err = GetDocHistorySnapshots(context.Background(), historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err == nil {
		t.Fatal("unauthenticated history matched")
	}
	entry = historySnapshotTestEntry(t, historyData)
	setEncryptedBoxState(historySnapshotBoxID, EncryptedBoxStateLocked)
	cachedDEKsLock.Lock()
	clear(cachedDEKs[historySnapshotBoxID])
	delete(cachedDEKs, historySnapshotBoxID)
	cachedDEKsLock.Unlock()
	if err = GetDocHistorySnapshots(context.Background(), historySnapshotDocID, []*DocHistorySnapshotEntry{entry}); err == nil {
		t.Fatal("locked history matched")
	}
}

func TestDocHistorySnapshotDigest(t *testing.T) {
	for _, data := range [][]byte{[]byte("broken"), []byte(`{"Spec":"999"}`), bytes.ReplaceAll(historySnapshotData("same"), []byte(historySnapshotDocID), []byte("20260928100000-otherid"))} {
		if _, err := docHistorySnapshotDigest(data, historySnapshotDocID); err == nil {
			t.Fatalf("invalid source accepted: %s", data)
		}
	}
	for _, query := range []struct {
		id, op  string
		created []string
	}{
		{"invalid", "all", []string{"1"}},
		{historySnapshotDocID, "all", nil},
		{historySnapshotDocID, "all", make([]string, 33)},
		{historySnapshotDocID, "' OR 1=1", []string{"1"}},
		{historySnapshotDocID, "all", []string{"bad"}},
	} {
		if _, err := ResolveDocHistorySnapshots(query.id, query.created, query.op); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
}
