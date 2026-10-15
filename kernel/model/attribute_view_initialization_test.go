// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAttributeViewInitializationCrypto(t *testing.T, boxes ...string) {
	t.Helper()
	oldDEK, oldBoxes := av.AVDEKProvider, av.AVEncryptedBoxIDs
	oldEncrypted, oldUnlocked := av.AVIsEncryptedBox, av.AVIsBoxUnlocked
	oldAcquire, oldRelease := av.AVLockAcquire, av.AVLockRelease
	av.AVDEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{0x62}, 32), nil }
	av.AVEncryptedBoxIDs = func() []string { return boxes }
	av.AVIsEncryptedBox = func(string) bool { return true }
	av.AVIsBoxUnlocked = func(string) bool { return true }
	av.AVLockAcquire, av.AVLockRelease = func(string) {}, func(string) {}
	t.Cleanup(func() {
		av.AVDEKProvider, av.AVEncryptedBoxIDs = oldDEK, oldBoxes
		av.AVIsEncryptedBox, av.AVIsBoxUnlocked = oldEncrypted, oldUnlocked
		av.AVLockAcquire, av.AVLockRelease = oldAcquire, oldRelease
	})
}

func TestAttributeViewInitializationConcurrentEncrypted(t *testing.T) {
	setupAttributeViewValidationTest(t)
	const boxID, avID = "20261012060000-initbox", "20261012060000-initav0"
	setupAttributeViewInitializationCrypto(t, boxID)
	firstEntered, releaseFirst := make(chan struct{}), make(chan struct{})
	var keyRequests atomic.Int32
	av.AVDEKProvider = func(string) ([]byte, error) {
		if keyRequests.Add(1) == 1 {
			close(firstEntered)
			<-releaseFirst
		}
		return bytes.Repeat([]byte{0x62}, 32), nil
	}
	type result struct {
		definition *av.AttributeView
		err        error
	}
	firstDone, secondDone := make(chan result, 1), make(chan result, 1)
	go func() {
		definition, err := initializeAttributeViewForRender("", avID, boxID, true, av.LayoutTypeTable)
		firstDone <- result{definition, err}
	}()
	select {
	case <-firstEntered:
	case <-time.After(5 * time.Second):
		close(releaseFirst)
		t.Fatal("first initialization did not reach encrypted save")
	}
	go func() {
		definition, err := initializeAttributeViewForRender("", avID, boxID, true, av.LayoutTypeTable)
		secondDone <- result{definition, err}
	}()
	var second result
	secondFinished := false
	select {
	case second = <-secondDone:
		secondFinished = true
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseFirst)
	first := <-firstDone
	if !secondFinished {
		second = <-secondDone
	}
	if nil != first.err || nil != second.err {
		t.Fatalf("encrypted initialization failed: %v, %v", first.err, second.err)
	}
	if first.definition == second.definition {
		t.Fatal("initialization shared a mutable definition between callers")
	}
	if av.GetAVBoxID(avID) != "" {
		t.Fatal("initialization retained pending box routing")
	}
	t.Cleanup(func() { av.SetAVBoxID(avID, "") })
	cache.RemoveAVDataInBox(avID, boxID)
	stored, err := av.ParseAttributeViewInBox(avID, boxID)
	if nil != err || len(stored.Views) != 1 || len(stored.KeyValues) != 2 {
		t.Fatalf("encrypted definition did not survive cold read: %#v, %v", stored, err)
	}
	for _, returned := range []*av.AttributeView{first.definition, second.definition} {
		if len(returned.Views) != 1 || returned.Views[0].ID != stored.Views[0].ID || len(returned.KeyValues) != len(stored.KeyValues) {
			t.Fatal("encrypted response view identity differs from disk")
		}
		for i, key := range returned.KeyValues {
			if key.Key.ID != stored.KeyValues[i].Key.ID {
				t.Fatal("encrypted response field identity differs from disk")
			}
		}
	}
	av.SetAVBoxID(avID, "")
	if _, err := os.Stat(av.GetAttributeViewDataPath(avID)); !os.IsNotExist(err) {
		t.Fatalf("encrypted initialization created a global definition: %v", err)
	}
}

func TestRenderAttributeViewConcurrentInitialization(t *testing.T) {
	setupAttributeViewValidationTest(t)
	type result struct {
		viewID string
		fields []string
		err    error
	}
	for round := 0; round < 32; round++ {
		avID := ast.NewNodeID()
		start, done := make(chan struct{}), make(chan result, 2)
		for i := 0; i < 2; i++ {
			go func() {
				<-start
				view, definition, _, err := RenderAttributeViewWithTarget("", avID, "", "", 1, -1, nil,
					av.LayoutTypeTable, true, true, "", "")
				if nil != err {
					done <- result{err: err}
					return
				}
				var fields []string
				for _, key := range definition.KeyValues {
					fields = append(fields, key.Key.ID)
				}
				done <- result{viewID: view.GetID(), fields: fields}
			}()
		}
		close(start)
		first, second := <-done, <-done
		if first.err != nil || second.err != nil {
			t.Fatalf("render errors: %v, %v", first.err, second.err)
		}
		data, err := os.ReadFile(av.GetAttributeViewDataPath(avID))
		if nil != err {
			t.Fatal(err)
		}
		var stored av.AttributeView
		if err := json.Unmarshal(data, &stored); nil != err {
			t.Fatal(err)
		}
		var fields []string
		for _, key := range stored.KeyValues {
			fields = append(fields, key.Key.ID)
		}
		if len(stored.Views) != 1 {
			t.Fatalf("unexpected stored views: %+v", stored.Views)
		}
		if first.viewID != stored.Views[0].ID || second.viewID != stored.Views[0].ID ||
			!reflect.DeepEqual(first.fields, fields) || !reflect.DeepEqual(second.fields, fields) {
			t.Fatalf("round %d response identity differs from disk: first=%+v second=%+v disk=%s fields=%v",
				round, first, second, stored.Views[0].ID, fields)
		}
		cache.RemoveAVDataInBox(avID, "")
		reopened, _, _, err := RenderAttributeViewWithTarget("", avID, "", "", 1, -1, nil,
			av.LayoutTypeTable, false, true, "", "")
		if nil != err || reopened.GetID() != first.viewID {
			t.Fatalf("cold reopening differs: %v", err)
		}
	}
}

func TestLockAttributeViewInitialization(t *testing.T) {
	const avID, otherID = "20261012060000-lockav0", "20261012060000-lockav1"
	unlock := lockAttributeViewInitialization(avID)
	started, acquired := make(chan struct{}), make(chan struct{})
	go func() {
		close(started)
		release := lockAttributeViewInitialization(avID)
		release()
		close(acquired)
	}()
	<-started
	otherAcquired := make(chan struct{})
	go func() {
		release := lockAttributeViewInitialization(otherID)
		release()
		close(otherAcquired)
	}()
	select {
	case <-otherAcquired:
	case <-time.After(5 * time.Second):
		unlock()
		t.Fatal("different databases shared an initialization lock")
	}
	select {
	case <-acquired:
		unlock()
		t.Fatal("same database entered initialization concurrently")
	default:
	}
	unlock()
	select {
	case <-acquired:
	case <-time.After(5 * time.Second):
		t.Fatal("waiting initialization did not resume")
	}
	attributeViewInitializationLocks.Lock()
	remaining := len(attributeViewInitializationLocks.entries)
	attributeViewInitializationLocks.Unlock()
	if remaining != 0 {
		t.Fatalf("initialization retained %d unused locks", remaining)
	}
}

func TestRenderAttributeViewInitializationPreservesBlockSelection(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	node := treenode.GetNodeInTree(fixture.tree, blockID)
	for _, selector := range []string{"", fixture.galleryView.ID} {
		if selector == "" {
			node.RemoveIALAttr(av.NodeAttrView)
		} else {
			node.SetIALAttr(av.NodeAttrView, selector)
		}
		if _, err := filesys.WriteTree(fixture.tree); err != nil {
			t.Fatal(err)
		}
		docPath := filepath.Join(util.DataDir, fixture.tree.Box, fixture.tree.Path)
		before, err := os.ReadFile(docPath)
		if err != nil {
			t.Fatal(err)
		}
		avPath := av.GetAttributeViewDataPath(fixture.attrView.ID)
		avBefore, err := os.ReadFile(avPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := initializeAttributeViewForRender(blockID, fixture.attrView.ID, "", true, av.LayoutTypeTable); err != nil {
			t.Fatal(err)
		}
		cache.RemoveTreeDataInBox(fixture.tree.ID, fixture.tree.Box)
		cache.RemoveAVDataInBox(fixture.attrView.ID, "")
		definition, err := av.ParseAttributeView(fixture.attrView.ID)
		if err != nil {
			t.Fatal(err)
		}
		view, err := getRenderAttributeViewView(definition, "", "", blockID, true)
		if err != nil {
			t.Fatal(err)
		}
		expected := selector
		if expected == "" {
			expected = fixture.tableView.ID
		}
		if view.ID != expected {
			t.Fatalf("resolved view %q, want %q", view.ID, expected)
		}
		after, err := os.ReadFile(docPath)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("initialization rewrote the carrier selector: %v", err)
		}
		avAfter, err := os.ReadFile(avPath)
		if err != nil || !bytes.Equal(avBefore, avAfter) {
			t.Fatalf("existing definition changed: %v", err)
		}
	}
}

func TestAttributeViewInitializationFailureAndBoundary(t *testing.T) {
	setupAttributeViewValidationTest(t)
	const firstBox, secondBox, avID = "20261012060000-firstbx", "20261012060000-otherbx", "20261012060000-boundav"
	setupAttributeViewInitializationCrypto(t, firstBox, secondBox)
	av.AVDEKProvider = func(string) ([]byte, error) { return nil, errors.New("test locked notebook") }
	if _, err := initializeAttributeViewForRender("", avID, firstBox, true, av.LayoutTypeTable); err == nil {
		t.Fatal("encrypted initialization succeeded without an accessible key")
	}
	if av.GetAVBoxID(avID) != "" {
		t.Fatal("failed initialization retained pending box routing")
	}
	av.AVDEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{0x62}, 32), nil }
	if _, err := initializeAttributeViewForRender("", avID, firstBox, true, av.LayoutTypeTable); err != nil {
		t.Fatal(err)
	}
	for _, boxID := range []string{"", secondBox} {
		if _, err := initializeAttributeViewForRender("", avID, boxID, true, av.LayoutTypeTable); !errors.Is(err, av.ErrAttributeViewNotFound) {
			t.Fatalf("initialization escaped its boundary %q: %v", boxID, err)
		}
		path := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("unexpected foreign definition: %v", err)
		}
	}
}

type attributeViewInitializationTestError struct {
	calls  atomic.Int32
	logged chan struct{}
	resume <-chan struct{}
}

func (err *attributeViewInitializationTestError) Error() string {
	// Save 和 render 分别记录错误；后者已离开初始化临界区，在此固定失败返回与重试的交错顺序。
	if err.calls.Add(1) == 2 {
		close(err.logged)
		<-err.resume
	}
	return "test initialization key failure"
}

func TestRenderAttributeViewInitializationFailedRequestDoesNotClearRetry(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	boxID, avID := fixture.tree.Box, ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(boxID) })
	setupAttributeViewInitializationCrypto(t, boxID)
	resumeError, releaseRetry := make(chan struct{}), make(chan struct{})
	keyErr := &attributeViewInitializationTestError{logged: make(chan struct{}), resume: resumeError}
	retryEntered := make(chan struct{})
	var attempts atomic.Int32
	av.AVDEKProvider = func(string) ([]byte, error) {
		switch attempts.Add(1) {
		case 1:
			return nil, keyErr
		case 2:
			close(retryEntered)
			<-releaseRetry
		}
		return bytes.Repeat([]byte{0x62}, 32), nil
	}
	firstDone, retryDone := make(chan error, 1), make(chan error, 1)
	go func() {
		_, _, _, err := RenderAttributeViewWithTarget(blockID, avID, "", "", 1, -1, nil,
			av.LayoutTypeTable, true, true, "", "")
		firstDone <- err
	}()
	select {
	case <-keyErr.logged:
	case <-time.After(5 * time.Second):
		close(resumeError)
		<-firstDone
		t.Fatal("failed render did not leave initialization")
	}
	go func() {
		_, err := initializeAttributeViewForRender("", avID, boxID, true, av.LayoutTypeTable)
		retryDone <- err
	}()
	select {
	case <-retryEntered:
	case <-time.After(5 * time.Second):
		close(resumeError)
		close(releaseRetry)
		<-firstDone
		<-retryDone
		t.Fatal("retry could not acquire initialization after failure")
	}
	close(resumeError)
	firstErr := <-firstDone
	pending := av.GetAVBoxID(avID)
	close(releaseRetry)
	retryErr := <-retryDone
	if firstErr != keyErr || retryErr != nil {
		t.Fatalf("unexpected failure/retry results: %v, %v", firstErr, retryErr)
	}
	if pending != boxID {
		t.Fatalf("failed render cleared retry routing: got %q, want %q", pending, boxID)
	}
	if av.GetAVBoxID(avID) != "" {
		t.Fatal("successful retry retained pending box routing")
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
	data, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(data) {
		t.Fatalf("retry did not write encrypted definition: %v", err)
	}
	cache.RemoveAVDataInBox(avID, boxID)
	stored, err := av.ParseAttributeViewByPath(path)
	if err != nil || len(stored.Views) != 1 || len(stored.KeyValues) != 2 {
		t.Fatalf("retry did not survive authenticated cold read: %v", err)
	}
	if _, err := os.Stat(av.GetAttributeViewDataPath(avID)); !os.IsNotExist(err) {
		t.Fatalf("retry wrote a global definition: %v", err)
	}
}

func TestRenderAttributeViewInitializationPreservesExistingAndReadOnly(t *testing.T) {
	setupAttributeViewValidationTest(t)
	avID := ast.NewNodeID()
	if _, _, _, err := RenderAttributeViewWithTarget("", avID, "", "", 1, -1, nil, av.LayoutTypeTable,
		false, true, "", ""); !errors.Is(err, av.ErrAttributeViewNotFound) {
		t.Fatalf("missing read result: %v", err)
	}
	if _, _, _, err := RenderAttributeViewWithTargetReadOnly("", avID, "", "", 1, -1, nil, av.LayoutTypeTable,
		true, true, "", ""); !errors.Is(err, av.ErrAttributeViewNotFound) {
		t.Fatalf("read-only create result: %v", err)
	}
	if _, err := os.Stat(av.GetAttributeViewDataPath(avID)); !os.IsNotExist(err) {
		t.Fatalf("read-only created a definition: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(av.GetAttributeViewDataPath(avID)), 0755); err != nil {
		t.Fatal(err)
	}
	for _, original := range [][]byte{[]byte("broken definition"), []byte(`{"id":"` + avID + `","spec":999999}`)} {
		if err := os.WriteFile(av.GetAttributeViewDataPath(avID), original, 0644); err != nil {
			t.Fatal(err)
		}
		cache.RemoveAVDataInBox(avID, "")
		if _, _, _, err := RenderAttributeViewWithTarget("", avID, "", "", 1, -1, nil, av.LayoutTypeTable,
			true, true, "", ""); err == nil {
			t.Fatal("invalid existing definition was accepted")
		}
		stored, err := os.ReadFile(av.GetAttributeViewDataPath(avID))
		if err != nil || !bytes.Equal(stored, original) {
			t.Fatalf("invalid definition was overwritten: %v", err)
		}
	}
}
