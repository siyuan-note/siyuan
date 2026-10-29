// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupCollectionIndexTest(t *testing.T) {
	t.Helper()
	oldData := util.DataDir
	util.DataDir = t.TempDir()
	cache.ClearAVCache()
	t.Cleanup(func() {
		util.DataDir = oldData
		cache.ClearAVCache()
		collectionIndex.Lock()
		resetCollectionIndexLocked()
		collectionIndex.Unlock()
	})
}

func writeCollectionIndexView(t *testing.T, view *AttributeView) {
	t.Helper()
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	path := attributeViewDataPathByBox(view.ID, "")
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func collectionIndexTestView() *AttributeView {
	return &AttributeView{ID: ast.NewNodeID(), Automations: &AutomationConfig{Spec: 5, Rules: []*AutomationRule{{
		Enabled: true, Trigger: "block", BlockSource: &AutomationBlockSource{DocumentIDs: []string{ast.NewNodeID()}, DocumentDepth: new(1)},
	}}}}
}

func TestBlockCollectionIndexEmptyAndInvalidation(t *testing.T) {
	setupCollectionIndexTest(t)
	if BlockCollectionIndexKnownEmpty("") {
		t.Fatal("unknown index was treated as empty")
	}
	index, err := BlockCollectionIndexInBox("")
	if err != nil || !index.Empty() || !BlockCollectionIndexKnownEmpty("") {
		t.Fatal("empty directory was not cached", err)
	}
	if allocations := testing.AllocsPerRun(100, func() {
		if !BlockCollectionIndexKnownEmpty("") {
			t.Fatal("lost empty cache")
		}
	}); allocations != 0 {
		t.Fatalf("empty hot path allocated: %g", allocations)
	}
	view := collectionIndexTestView()
	writeCollectionIndexView(t, view)
	cache.ClearAVCache()
	if index.Current() || BlockCollectionIndexKnownEmpty("") {
		t.Fatal("cache generation did not invalidate empty snapshot")
	}
	index, err = BlockCollectionIndexInBox("")
	if err != nil || !slices.Equal(index.ids, []string{view.ID}) {
		t.Fatal("cold discovery missed persisted rule", err)
	}
	oldData := util.DataDir
	util.DataDir = t.TempDir()
	if index.Current() || BlockCollectionIndexKnownEmpty("") {
		t.Fatal("workspace switch retained old index")
	}
	other, err := BlockCollectionIndexInBox("")
	util.DataDir = oldData
	if err != nil || !other.Empty() {
		t.Fatal("workspace index was not isolated", err)
	}
}

func TestBlockCollectionIndexScopesAndSnapshots(t *testing.T) {
	setupCollectionIndexTest(t)
	view := collectionIndexTestView()
	source := view.Automations.Rules[0].BlockSource
	parent, child, notebook := source.DocumentIDs[0], ast.NewNodeID(), ast.NewNodeID()
	writeCollectionIndexView(t, view)
	index, err := BlockCollectionIndexInBox("")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		id, path string
		want     bool
	}{
		{parent, "/" + parent + ".sy", true},
		{child, "/" + parent + "/" + child + ".sy", true},
		{child, "/" + parent + "/" + ast.NewNodeID() + "/" + child + ".sy", false},
		{child, "/" + child + ".sy", false},
	} {
		if got := index.MatchesDocument(notebook, test.id, test.path); got != test.want {
			t.Fatalf("document scope %s: %v, want %v", test.path, got, test.want)
		}
	}
	view.Name = "Updated rows and display only"
	rememberCollectionView(view, "")
	if !index.Current() {
		t.Fatal("unchanged scope invalidated shared snapshot")
	}
	rememberCollectionView(&AttributeView{ID: ast.NewNodeID()}, "")
	if !index.Current() {
		t.Fatal("database without rules invalidated shared snapshot")
	}
	source.NotebookIDs = []string{notebook}
	rememberCollectionView(view, "")
	updated, err := BlockCollectionIndexInBox("")
	if err != nil || index.Current() || !updated.MatchesDocument(notebook, child, "/"+child+".sy") {
		t.Fatal("scope update did not invalidate snapshot", err)
	}
	if index.MatchesDocument(notebook, child, "/"+child+".sy") {
		t.Fatal("saved scope mutated earlier snapshot")
	}
	source.NotebookIDs[0] = ast.NewNodeID()
	if !updated.MatchesDocument(notebook, child, "/"+child+".sy") {
		t.Fatal("caller mutated cached scope")
	}
	if allocations := testing.AllocsPerRun(100, func() {
		for id := range updated.ViewIDsForDocument(notebook, child, "/child.sy") {
			if id != view.ID {
				t.Fatal("unexpected view")
			}
		}
	}); allocations != 0 {
		t.Fatalf("candidate iteration allocated: %g", allocations)
	}
	view.Automations.Rules[0].Enabled = false
	rememberCollectionView(view, "")
	if updated.Current() || !BlockCollectionIndexKnownEmpty("") {
		t.Fatal("disabling last rule did not update empty fast path")
	}
	view.Automations.Rules[0].Enabled = true
	view.Automations.Spec = 9
	rememberCollectionView(view, "")
	unknown, err := BlockCollectionIndexInBox("")
	if err != nil || !unknown.MatchesDocument("unrelated", child, "/child.sy") {
		t.Fatal("unknown specification was silently excluded", err)
	}
	ClearBlockCollectionIndex("")
	if unknown.Current() || BlockCollectionIndexKnownEmpty("") {
		t.Fatal("explicit clear retained snapshot")
	}
}

func TestBlockCollectionIndexSelectedDocuments(t *testing.T) {
	setupCollectionIndexTest(t)
	view := collectionIndexTestView()
	source := view.Automations.Rules[0].BlockSource
	parent, child := source.DocumentIDs[0], ast.NewNodeID()
	writeCollectionIndexView(t, view)
	before, err := BlockCollectionIndexInBox("")
	if err != nil {
		t.Fatal(err)
	}
	source.IncludeSelectedDocuments = new(true)
	rememberCollectionView(view, "")
	if !before.Current() {
		t.Fatal("explicit default invalidated identical scope")
	}
	view.Automations.Spec = 7
	source.IncludeSelectedDocuments = new(false)
	rememberCollectionView(view, "")
	index, err := BlockCollectionIndexInBox("")
	if err != nil || before.Current() || index.MatchesDocument("", parent, "/"+parent+".sy") ||
		!index.MatchesDocument("", child, "/"+parent+"/"+child+".sy") {
		t.Fatal("scope exclusion did not update snapshot", err)
	}
	if !before.MatchesDocument("", parent, "/"+parent+".sy") {
		t.Fatal("exclusion mutated previous snapshot")
	}
	*source.IncludeSelectedDocuments = true
	if index.MatchesDocument("", parent, "/"+parent+".sy") {
		t.Fatal("caller mutated immutable exclusion snapshot")
	}
	// Persist and reload to cover cold discovery, not just the hot save path.
	*source.IncludeSelectedDocuments = false
	writeCollectionIndexView(t, view)
	cache.ClearAVCache()
	index, err = BlockCollectionIndexInBox("")
	if err != nil || index.MatchesDocument("", parent, "/"+parent+".sy") {
		t.Fatal("cold discovery lost scope exclusion", err)
	}
	source.IncludeSelectedDocuments = nil
	rememberCollectionView(view, "")
	restored, err := BlockCollectionIndexInBox("")
	if err != nil || index.Current() || !restored.MatchesDocument("", parent, "/"+parent+".sy") {
		t.Fatal("restoring default did not invalidate exclusion snapshot", err)
	}
}

func TestBlockCollectionIndexCorruptionFailsClosed(t *testing.T) {
	setupCollectionIndexTest(t)
	view := collectionIndexTestView()
	writeCollectionIndexView(t, view)
	path := attributeViewDataPathByBox(view.ID, "")
	corrupt := []byte(`{"automations":`)
	if err := os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := BlockCollectionIndexInBox(""); err == nil || BlockCollectionIndexKnownEmpty("") {
		t.Fatal("corrupt database was treated as empty")
	}
	retained, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(retained, corrupt) {
		t.Fatal("index discovery changed corrupt source", err)
	}
	view.Spec = CurrentSpec + 1
	writeCollectionIndexView(t, view)
	index, err := BlockCollectionIndexInBox("")
	if err != nil || !index.MatchesDocument("unrelated", "unrelated", "/unrelated.sy") {
		t.Fatal("unknown database specification was silently excluded", err)
	}
}

func TestBlockCollectionIndexEncryptedAuthenticationAndLock(t *testing.T) {
	setupCollectionIndexTest(t)
	boxID := ast.NewNodeID()
	view := collectionIndexTestView()
	oldDEK, oldEncrypted, oldUnlocked := AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked
	oldAcquire, oldRelease := AVLockAcquire, AVLockRelease
	key, unlocked := bytes.Repeat([]byte{0x71}, 32), true
	AVDEKProvider = func(string) ([]byte, error) { return key, nil }
	AVIsEncryptedBox = func(id string) bool { return id == boxID }
	AVIsBoxUnlocked = func(string) bool { return unlocked }
	AVLockAcquire, AVLockRelease = func(string) {}, func(string) {}
	SetAVBoxID(view.ID, boxID)
	t.Cleanup(func() {
		SetAVBoxID(view.ID, "")
		AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked = oldDEK, oldEncrypted, oldUnlocked
		AVLockAcquire, AVLockRelease = oldAcquire, oldRelease
	})
	plain, _ := json.Marshal(view)
	ciphertext, err := encryptAVData(boxID, view.ID, plain)
	if err != nil {
		t.Fatal(err)
	}
	path := attributeViewDataPathByBox(view.ID, boxID)
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	// 扫描过程中发布的新范围优先于扫描开始时的文件内容。
	AVDEKProvider = func(string) ([]byte, error) {
		updated := collectionIndexTestView()
		updated.ID = view.ID
		updated.Automations.Rules[0].BlockSource.NotebookIDs = []string{boxID}
		rememberCollectionView(updated, boxID)
		return key, nil
	}
	index, err := BlockCollectionIndexInBox(boxID)
	if err != nil || !index.MatchesDocument(boxID, "other", "/other.sy") {
		t.Fatal("concurrent saved scope was lost", err)
	}
	ClearBlockCollectionIndex(boxID)
	unlocked = false
	if index.Current() {
		t.Fatal("locked boundary retained plaintext scope")
	}
	if _, err = BlockCollectionIndexInBox(boxID); err == nil {
		t.Fatal("locked boundary returned cached rules")
	}
	unlocked = true
	AVDEKProvider = func(string) ([]byte, error) { unlocked = false; return key, nil }
	if _, err = BlockCollectionIndexInBox(boxID); err == nil || BlockCollectionIndexKnownEmpty(boxID) {
		t.Fatal("scan published a scope after locking")
	}
	unlocked = true
	AVDEKProvider = func(string) ([]byte, error) { return key, nil }
	corrupt := bytes.Clone(ciphertext)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = BlockCollectionIndexInBox(boxID); err == nil || BlockCollectionIndexKnownEmpty(boxID) {
		t.Fatal("unauthenticated rules were accepted")
	}
	retained, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(retained, corrupt) {
		t.Fatal("authentication failure changed ciphertext", err)
	}
}
