// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type storageContextFixture struct {
	id, boxA, boxB string
	locked         map[string]bool
}

func setupStorageContextTest(t *testing.T) storageContextFixture {
	t.Helper()
	fixture := storageContextFixture{id: ast.NewNodeID(), boxA: ast.NewNodeID(), boxB: ast.NewNodeID(), locked: map[string]bool{}}
	oldData := util.DataDir
	oldDEK, oldEncrypted, oldUnlocked, oldBoxes := AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked, AVEncryptedBoxIDs
	oldAcquire, oldRelease := AVLockAcquire, AVLockRelease
	util.DataDir = t.TempDir()
	keys := map[string][]byte{fixture.boxA: bytes.Repeat([]byte{0x61}, 32), fixture.boxB: bytes.Repeat([]byte{0x62}, 32)}
	AVDEKProvider = func(boxID string) ([]byte, error) {
		if fixture.locked[boxID] || keys[boxID] == nil {
			return nil, errors.New("test notebook is locked")
		}
		return keys[boxID], nil
	}
	AVIsEncryptedBox = func(boxID string) bool { return keys[boxID] != nil }
	AVIsBoxUnlocked = func(boxID string) bool { return keys[boxID] != nil && !fixture.locked[boxID] }
	AVEncryptedBoxIDs = func() []string { return []string{fixture.boxA, fixture.boxB} }
	AVLockAcquire, AVLockRelease = func(string) {}, func(string) {}
	t.Cleanup(func() {
		SetAVBoxID(fixture.id, "")
		for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
			cache.RemoveAVDataInBox(fixture.id, boxID)
		}
		util.DataDir = oldData
		AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked, AVEncryptedBoxIDs = oldDEK, oldEncrypted, oldUnlocked, oldBoxes
		AVLockAcquire, AVLockRelease = oldAcquire, oldRelease
	})
	return fixture
}

func (fixture storageContextFixture) seed(t *testing.T) map[string]*AttributeView {
	t.Helper()
	views := map[string]*AttributeView{}
	for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
		view := &AttributeView{ID: fixture.id, Spec: PlainTextSpec, Name: "initial:" + boxID}
		if err := view.SetStorageContext(boxID); err != nil {
			t.Fatal(err)
		}
		SetAVBoxID(fixture.id, fixture.boxB)
		if err := SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		views[boxID] = view
	}
	return views
}

func TestAttributeViewStorageContextValidationAndJSON(t *testing.T) {
	fixture := setupStorageContextTest(t)
	view := &AttributeView{ID: fixture.id, Spec: PlainTextSpec}
	before, err := gulu.JSON.MarshalJSON(view)
	if err != nil {
		t.Fatal(err)
	}
	if boxID, known := view.StorageContext(); known || boxID != "" {
		t.Fatal("unconfigured object unexpectedly had a storage boundary")
	}
	for _, boxID := range []string{fixture.boxA, ""} {
		if err = view.SetStorageContext(boxID); err != nil {
			t.Fatal(err)
		}
		if got, known := view.StorageContext(); !known || got != boxID {
			t.Fatalf("explicit storage boundary was not retained: %q %v", got, known)
		}
		after, err := gulu.JSON.MarshalJSON(view)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("private storage boundary leaked into JSON: %s %v", after, err)
		}
		var decoded AttributeView
		if err = json.Unmarshal(after, &decoded); err != nil {
			t.Fatal(err)
		}
		if _, known := decoded.StorageContext(); known {
			t.Fatal("JSON decode adopted an in-memory storage boundary")
		}
	}
	if err = view.SetStorageContext("../outside"); !errors.Is(err, ErrInvalidBoxID) {
		t.Fatalf("invalid notebook boundary was accepted: %v", err)
	}
	if boxID, known := view.StorageContext(); !known || boxID != "" {
		t.Fatal("failed boundary update changed the existing boundary")
	}
	view.ID = ast.NewNodeID()
	SetAVBoxID(view.ID, fixture.boxB)
	t.Cleanup(func() { SetAVBoxID(view.ID, "") })
	if _, known := view.StorageContext(); known {
		t.Fatal("changing database identity retained a stale storage boundary")
	}
	if path, boxID := view.StoragePath(); boxID != fixture.boxB || path != attributeViewDataPathByBox(view.ID, fixture.boxB) {
		t.Fatal("changed database identity did not use its own lookup")
	}
	for _, invalid := range []*AttributeView{nil, {}, {ID: "../outside"}} {
		if err = invalid.SetStorageContext(fixture.boxA); !errors.Is(err, ErrInvalidAttributeViewID) {
			t.Fatalf("invalid database identity was accepted: %v", err)
		}
	}
}

func TestAttributeViewStorageContextInterleavedSave(t *testing.T) {
	fixture := setupStorageContextTest(t)
	fixture.seed(t)
	loaded := map[string]*AttributeView{}
	for _, boxID := range []string{fixture.boxA, fixture.boxB, ""} {
		SetAVBoxID(fixture.id, fixture.boxB)
		view, err := ParseAttributeViewWithStorageContext(fixture.id, boxID)
		if err != nil || view.Name != "initial:"+boxID {
			t.Fatalf("exact read selected another database boundary: %q %v", boxID, err)
		}
		if GetAVBoxID(fixture.id) != fixture.boxB {
			t.Fatal("exact context read changed the global database mapping")
		}
		loaded[boxID] = view
	}
	for _, boxID := range []string{fixture.boxA, fixture.boxB, ""} {
		view := loaded[boxID]
		view.Name = "updated:" + boxID
		conflictingBox := fixture.boxA
		if boxID == fixture.boxA || boxID == "" {
			conflictingBox = fixture.boxB
		}
		SetAVBoxID(fixture.id, conflictingBox)
		if err := SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
		cache.RemoveAVDataInBox(fixture.id, boxID)
		view, err := ParseAttributeViewWithStorageContext(fixture.id, boxID)
		if err != nil || view.Name != "updated:"+boxID {
			t.Fatalf("interleaved save crossed storage boundaries: %q %v", boxID, err)
		}
		data, err := os.ReadFile(attributeViewDataPathByBox(fixture.id, boxID))
		if err != nil || util.IsCiphertext(data) != (boxID != "") || boxID != "" && bytes.Contains(data, []byte("updated:")) {
			t.Fatalf("storage boundary changed the authenticated data format: %q %v", boxID, err)
		}
	}
	path := attributeViewDataPathByBox(fixture.id, fixture.boxA)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	fixture.locked[fixture.boxA] = true
	SetAVBoxID(fixture.id, fixture.boxB)
	loaded[fixture.boxA].Name = "must not save"
	if err = SaveAttributeView(loaded[fixture.boxA]); err == nil {
		t.Fatal("locked explicit boundary fell back to an unlocked notebook")
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(before, after) {
		t.Fatal("locked explicit boundary changed its ciphertext")
	}
}

func TestAttributeViewStorageContextRecorderIsolation(t *testing.T) {
	fixture := setupStorageContextTest(t)
	views := fixture.seed(t)
	calls := map[string]int{}
	for _, boxID := range []string{fixture.boxA, fixture.boxB, ""} {
		SetAVBoxID(fixture.id, fixture.boxB)
		release := RecordSourceWrites(views[boxID], func() bool { return true }, func(recordedBox string, before, after []byte) error {
			if recordedBox != boxID || len(before) == 0 || len(after) == 0 {
				t.Fatalf("recorder crossed storage boundary: got %q want %q", recordedBox, boxID)
			}
			if boxID != "" {
				var err error
				before, err = decryptAVData(boxID, fixture.id, before)
				if err != nil {
					t.Fatal(err)
				}
				after, err = decryptAVData(boxID, fixture.id, after)
				if err != nil {
					t.Fatal(err)
				}
			}
			var previous, next AttributeView
			if err := json.Unmarshal(before, &previous); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(after, &next); err != nil {
				t.Fatal(err)
			}
			if previous.Name != "initial:"+boxID || next.Name != "recorded:"+boxID {
				t.Fatalf("recorder captured another notebook's data: %q -> %q", previous.Name, next.Name)
			}
			calls[boxID]++
			return nil
		})
		t.Cleanup(release)
	}
	for _, boxID := range []string{fixture.boxA, fixture.boxB, ""} {
		SetAVBoxID(fixture.id, fixture.boxB)
		views[boxID].Name = "recorded:" + boxID
		if err := SaveAttributeView(views[boxID]); err != nil {
			t.Fatal(err)
		}
	}
	for _, boxID := range []string{fixture.boxA, fixture.boxB, ""} {
		if calls[boxID] != 1 {
			t.Fatalf("recorder registrations collided for the same database ID: %v", calls)
		}
	}
}

func TestAttributeViewStorageContextExactRead(t *testing.T) {
	fixture := setupStorageContextTest(t)
	fixture.seed(t)
	for _, test := range []struct {
		id, boxID string
	}{
		{"../outside", fixture.boxA}, {fixture.id, "../outside"}, {fixture.id, ast.NewNodeID()},
	} {
		if view, err := ParseAttributeViewWithStorageContext(test.id, test.boxID); err == nil || view != nil {
			t.Fatalf("invalid exact source fell back to an existing database: %+v %v", test, err)
		}
	}
	path := attributeViewDataPathByBox(fixture.id, fixture.boxA)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveAVDataInBox(fixture.id, fixture.boxA)
	SetAVBoxID(fixture.id, fixture.boxB)
	if view, err := ParseAttributeViewWithStorageContext(fixture.id, fixture.boxA); err == nil || view != nil {
		t.Fatal("authentication failure fell back to another storage boundary")
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(data, after) {
		t.Fatal("failed exact read modified its corrupt source")
	}
	wrongID := &AttributeView{ID: ast.NewNodeID(), Spec: PlainTextSpec}
	data, err = json.Marshal(wrongID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(attributeViewDataPathByBox(fixture.id, ""), data, 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveAVDataInBox(fixture.id, "")
	if _, err = ParseAttributeViewWithStorageContext(fixture.id, ""); !errors.Is(err, ErrInvalidAttributeViewID) {
		t.Fatalf("exact read pinned a different database identity: %v", err)
	}
}

func TestAttributeViewStorageContextLegacyRouting(t *testing.T) {
	fixture := setupStorageContextTest(t)
	fixture.seed(t)
	legacy, err := ParseAttributeViewInBox(fixture.id, fixture.boxA)
	if err != nil {
		t.Fatal(err)
	}
	if _, known := legacy.StorageContext(); known {
		t.Fatal("ordinary parse unexpectedly opted into explicit storage context")
	}
	SetAVBoxID(fixture.id, fixture.boxB)
	if path, boxID := legacy.StoragePath(); boxID != fixture.boxB || path != attributeViewDataPathByBox(fixture.id, fixture.boxB) {
		t.Fatal("legacy object did not retain mapping-based path resolution")
	}
	legacy.Name = "legacy mapped save"
	if err = SaveAttributeView(legacy); err != nil {
		t.Fatal(err)
	}
	for _, boxID := range []string{fixture.boxA, fixture.boxB} {
		view, err := ParseAttributeViewWithStorageContext(fixture.id, boxID)
		if err != nil {
			t.Fatal(err)
		}
		want := "initial:" + boxID
		if boxID == fixture.boxB {
			want = "legacy mapped save"
		}
		if view.Name != want {
			t.Fatalf("legacy save routing changed: box %s got %s want %s", boxID, view.Name, want)
		}
	}
}

func TestAttributeViewStorageContextRelationIndex(t *testing.T) {
	fixture := setupStorageContextTest(t)
	shared := ast.NewNodeID()
	leaves := map[string]string{"": ast.NewNodeID(), fixture.boxA: ast.NewNodeID(), fixture.boxB: ast.NewNodeID()}
	for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
		relations := map[string][]string{fixture.id: {shared, shared}, shared: {leaves[boxID], fixture.id}, leaves[boxID]: {shared}}
		if err := writeRelations(boxID, relations); err != nil {
			t.Fatal(err)
		}
	}
	SetAVBoxID(fixture.id, fixture.boxB)
	SetAVBoxID(shared, fixture.boxB)
	t.Cleanup(func() { SetAVBoxID(shared, "") })
	for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
		direct, err := GetSrcAvIDsInBoxWithErr(fixture.id, boxID)
		if err != nil || !slices.Equal(direct, []string{shared, shared}) {
			t.Fatalf("exact direct dependencies changed: %q %v %v", boxID, direct, err)
		}
		refresh, err := GetSrcAvIDsForRefreshInBox([]string{fixture.id, fixture.id}, boxID)
		if err != nil || !slices.Equal(refresh, []string{shared, leaves[boxID]}) {
			t.Fatalf("dependency refresh crossed its exact storage boundary: %q %v %v", boxID, refresh, err)
		}
		if GetAVBoxID(fixture.id) != fixture.boxB || GetAVBoxID(shared) != fixture.boxB {
			t.Fatal("exact dependency reads changed global mappings")
		}
	}
	if _, err := GetSrcAvIDsInBoxWithErr(fixture.id, "../outside"); !errors.Is(err, ErrInvalidBoxID) {
		t.Fatalf("invalid direct dependency boundary was accepted: %v", err)
	}
	if _, err := GetSrcAvIDsForRefreshInBox([]string{fixture.id}, "../outside"); !errors.Is(err, ErrInvalidBoxID) {
		t.Fatalf("invalid refresh boundary was accepted: %v", err)
	}
	fixture.locked[fixture.boxA] = true
	if _, err := GetSrcAvIDsInBoxWithErr(fixture.id, fixture.boxA); err == nil {
		t.Fatal("locked dependency read fell back to another notebook")
	}
	if _, err := GetSrcAvIDsForRefreshInBox([]string{fixture.id}, fixture.boxA); err == nil {
		t.Fatal("locked dependency refresh silently omitted its error")
	}
	fixture.locked[fixture.boxA] = false
	path := relationsPath(fixture.boxA)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = GetSrcAvIDsInBoxWithErr(fixture.id, fixture.boxA); err == nil {
		t.Fatal("corrupt dependency index was accepted")
	}
	if _, err = GetSrcAvIDsForRefreshInBox([]string{fixture.id}, fixture.boxA); err == nil {
		t.Fatal("corrupt refresh index was accepted")
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(data, after) {
		t.Fatal("failed dependency read changed its source")
	}
}

func TestAttributeViewStorageContextMirrorIndex(t *testing.T) {
	fixture := setupStorageContextTest(t)
	boxes := []string{"", fixture.boxA, fixture.boxB}
	mirrors := map[string][]string{}
	before := map[string][]byte{}
	for _, boxID := range boxes {
		mirrors[boxID] = []string{ast.NewNodeID(), ast.NewNodeID()}
		if err := writeMirrorBlocks(boxID, map[string][]string{fixture.id: mirrors[boxID], ast.NewNodeID(): {ast.NewNodeID()}}); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(mirrorBlocksPath(boxID))
		if err != nil || util.IsCiphertext(data) != (boxID != "") {
			t.Fatalf("mirror index fixture is not in its expected storage format: %q %v", boxID, err)
		}
		before[boxID] = data
	}
	SetAVBoxID(fixture.id, fixture.boxB)
	for _, boxID := range boxes {
		actual, err := GetAttributeViewBlockIDsInBox(fixture.id, boxID)
		if err != nil || !slices.Equal(actual, mirrors[boxID]) {
			t.Fatalf("same-ID mirror lookup crossed storage boundaries: %q %v %v", boxID, actual, err)
		}
		if GetAVBoxID(fixture.id) != fixture.boxB {
			t.Fatal("exact mirror lookup changed the global database mapping")
		}
		if actual, err = GetAttributeViewBlockIDsInBox(ast.NewNodeID(), boxID); err != nil || len(actual) != 0 {
			t.Fatalf("missing database mirrors returned another database's blocks: %v %v", actual, err)
		}
		if data, err := os.ReadFile(mirrorBlocksPath(boxID)); err != nil || !bytes.Equal(before[boxID], data) {
			t.Fatal("exact mirror lookup changed the index")
		}
	}
	if _, err := GetAttributeViewBlockIDsInBox("../outside", fixture.boxA); !errors.Is(err, ErrInvalidAttributeViewID) {
		t.Fatalf("invalid mirror database identity was accepted: %v", err)
	}
	if _, err := GetAttributeViewBlockIDsInBox(fixture.id, "../outside"); !errors.Is(err, ErrInvalidBoxID) {
		t.Fatalf("invalid mirror storage boundary was accepted: %v", err)
	}
	fixture.locked[fixture.boxA] = true
	if actual, err := GetAttributeViewBlockIDsInBox(fixture.id, fixture.boxA); err == nil || actual != nil {
		t.Fatalf("locked mirror lookup fell back to another boundary: %v %v", actual, err)
	}
	fixture.locked[fixture.boxA] = false
	for _, boxID := range []string{"", fixture.boxA} {
		corrupt := []byte{0xc1} // MessagePack 保留字节不能构成有效镜像索引。
		if boxID != "" {
			corrupt = bytes.Clone(before[boxID])
			corrupt[len(corrupt)-1] ^= 1
		}
		path := mirrorBlocksPath(boxID)
		if err := os.WriteFile(path, corrupt, 0600); err != nil {
			t.Fatal(err)
		}
		if actual, err := GetAttributeViewBlockIDsInBox(fixture.id, boxID); err == nil || actual != nil {
			t.Fatalf("corrupt mirror lookup ignored its error: %q %v %v", boxID, actual, err)
		}
		if data, err := os.ReadFile(path); err != nil || !bytes.Equal(corrupt, data) {
			t.Fatal("failed mirror lookup changed its source")
		}
	}
}

func TestAttributeViewStorageContextRelationIndexWrites(t *testing.T) {
	fixture := setupStorageContextTest(t)
	source, retained, other := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	boxes := []string{"", fixture.boxA, fixture.boxB}
	for _, boxID := range boxes {
		if err := writeRelations(boxID, map[string][]string{fixture.id: {source, retained}, other: {retained}}); err != nil {
			t.Fatal(err)
		}
	}
	SetAVBoxID(fixture.id, fixture.boxB)
	SetAVBoxID(source, fixture.boxB)
	t.Cleanup(func() { SetAVBoxID(source, "") })
	snapshot := func() map[string][]byte {
		t.Helper()
		data := map[string][]byte{}
		for _, boxID := range boxes {
			var err error
			data[boxID], err = os.ReadFile(relationsPath(boxID))
			if err != nil {
				t.Fatal(err)
			}
		}
		return data
	}
	for _, boxID := range boxes {
		for _, operation := range []struct {
			name string
			run  func(string, string, string) error
			want []string
		}{
			{"remove", RemoveAvRelInBoxWithErr, []string{retained}},
			{"upsert", UpsertAvBackRelInBoxWithErr, []string{retained, source}},
			{"duplicate upsert", UpsertAvBackRelInBoxWithErr, []string{retained, source}},
		} {
			before := snapshot()
			if err := operation.run(source, fixture.id, boxID); err != nil {
				t.Fatal(err)
			}
			actual, err := readRelations(boxID)
			if err != nil || !slices.Equal(actual[fixture.id], operation.want) || !slices.Equal(actual[other], []string{retained}) {
				t.Fatalf("exact %s changed unrelated dependencies: %q %v %v", operation.name, boxID, actual, err)
			}
			for scope, after := range snapshot() {
				if scope != boxID && !bytes.Equal(before[scope], after) {
					t.Fatalf("exact %s changed another storage boundary: %q -> %q", operation.name, boxID, scope)
				}
			}
			if GetAVBoxID(fixture.id) != fixture.boxB || GetAVBoxID(source) != fixture.boxB {
				t.Fatal("exact relation write changed global mappings")
			}
		}
	}
	before := snapshot()
	injected := errors.New("injected exact relation recorder failure")
	called := false
	release := RecordRelationWrites(fixture.boxA, func(boxID string, old, next []byte) error {
		called = true
		if boxID != fixture.boxA || !bytes.Equal(before[fixture.boxA], old) || len(next) == 0 {
			t.Fatal("exact relation recorder received another boundary's bytes")
		}
		return injected
	})
	t.Cleanup(release)
	if err := RemoveAvRelInBoxWithErr(source, fixture.id, fixture.boxA); !errors.Is(err, injected) || !called {
		t.Fatalf("exact relation removal ignored its recorder error: %v", err)
	}
	release()
	for scope, after := range snapshot() {
		if !bytes.Equal(before[scope], after) {
			t.Fatal("rejected exact relation removal changed an index")
		}
	}
}

func TestAttributeViewStorageContextRelationIndexWriteErrors(t *testing.T) {
	fixture := setupStorageContextTest(t)
	source := ast.NewNodeID()
	for _, boxID := range []string{"", fixture.boxA, fixture.boxB} {
		if err := writeRelations(boxID, map[string][]string{fixture.id: {source}}); err != nil {
			t.Fatal(err)
		}
	}
	SetAVBoxID(fixture.id, fixture.boxB)
	for _, operation := range []func(string, string, string) error{RemoveAvRelInBoxWithErr, UpsertAvBackRelInBoxWithErr} {
		if err := operation(source, fixture.id, "../outside"); !errors.Is(err, ErrInvalidBoxID) {
			t.Fatalf("invalid relation-write boundary was accepted: %v", err)
		}
		if err := operation("", fixture.id, fixture.boxA); !errors.Is(err, ErrInvalidAttributeViewID) {
			t.Fatalf("invalid relation-write identity was accepted: %v", err)
		}
	}
	for _, boxID := range []string{"", fixture.boxA} {
		path := relationsPath(boxID)
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		corrupt := []byte("invalid relation index")
		if boxID != "" {
			corrupt = bytes.Clone(before)
			corrupt[len(corrupt)-1] ^= 1
		}
		if err = os.WriteFile(path, corrupt, 0600); err != nil {
			t.Fatal(err)
		}
		for _, operation := range []func(string, string, string) error{RemoveAvRelInBoxWithErr, UpsertAvBackRelInBoxWithErr} {
			if err = operation(source, fixture.id, boxID); err == nil {
				t.Fatal("exact relation write ignored corrupt index data")
			}
			if after, err := os.ReadFile(path); err != nil || !bytes.Equal(corrupt, after) {
				t.Fatal("failed relation write changed its corrupt source")
			}
		}
		if err = os.WriteFile(path, before, 0600); err != nil {
			t.Fatal(err)
		}
	}
	fixture.locked[fixture.boxA] = true
	before, err := os.ReadFile(relationsPath(fixture.boxA))
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range []func(string, string, string) error{RemoveAvRelInBoxWithErr, UpsertAvBackRelInBoxWithErr} {
		if err = operation(source, fixture.id, fixture.boxA); err == nil {
			t.Fatal("locked relation write fell back to another notebook")
		}
	}
	if after, err := os.ReadFile(relationsPath(fixture.boxA)); err != nil || !bytes.Equal(before, after) {
		t.Fatal("locked relation write changed its ciphertext")
	}
}
