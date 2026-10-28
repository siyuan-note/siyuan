// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSelectShorthandSaveBox(t *testing.T) {
	boxes := []*Box{
		{ID: "20260830000000-first", Closed: false},
		{ID: "20260830000001-locked", Closed: true, Encrypted: true},
		{ID: "20260830000002-encrypted", Closed: false, Encrypted: true},
		{ID: "20260830000003-closed", Closed: true},
		{ID: "20260830000004-open", Closed: false},
	}

	if got := selectShorthandSaveBox("", boxes); nil == got || "20260830000000-first" != got.ID {
		t.Fatalf("select default shorthand box failed: %v", got)
	}
	if got := selectShorthandSaveBox("20260830000004-open", boxes); nil == got || "20260830000004-open" != got.ID {
		t.Fatalf("select configured shorthand box failed: %v", got)
	}
	for _, id := range []string{"20260830000001-locked", "20260830000002-encrypted", "20260830000003-closed", "missing"} {
		if got := selectShorthandSaveBox(id, boxes); nil != got {
			t.Fatalf("unavailable shorthand box [%s] should not be selected: %v", id, got)
		}
	}
}

func TestSelectShorthandSaveBoxSkipsUserGuide(t *testing.T) {
	boxes := []*Box{
		nil,
		{ID: "20210808180117-czj9bvb", Closed: false},
		{ID: "20260830000004-open", Closed: false},
	}
	got := selectShorthandSaveBox("", boxes)
	if nil == got || "20260830000004-open" != got.ID {
		t.Fatalf("user guide should not be selected: %v", got)
	}
	if got = selectShorthandSaveBox("20210808180117-czj9bvb", boxes); nil != got {
		t.Fatalf("configured user guide should not be selected: %v", got)
	}
	if got = selectShorthandSaveBox("", boxes[:2]); nil != got {
		t.Fatalf("no shorthand box should be selected: %v", got)
	}
}

func TestMoveLocalShorthandsKeepsSourceWhileSyncing(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Lang = "en"
	originalShortcutsPath := util.ShortcutsPath
	util.ShortcutsPath = t.TempDir()
	t.Cleanup(func() {
		util.ShortcutsPath = originalShortcutsPath
	})

	shorthandsDir := filepath.Join(util.ShortcutsPath, "shorthands")
	if err := os.MkdirAll(shorthandsDir, 0755); nil != err {
		t.Fatalf("create shorthand directory failed: %v", err)
	}
	shorthandPath := filepath.Join(shorthandsDir, "1788062238740.md")
	if err := os.WriteFile(shorthandPath, []byte("retained shorthand"), 0644); nil != err {
		t.Fatalf("write shorthand file failed: %v", err)
	}

	syncLock.Lock()
	_, err := MoveLocalShorthands(fixture.box.ID)
	syncLock.Unlock()
	if nil == err {
		t.Fatal("expected shorthand move to pause while syncing")
	}
	if _, statErr := os.Stat(shorthandPath); nil != statErr {
		t.Fatalf("shorthand source was not retained: %v", statErr)
	}
}

func TestVerifyShorthandDocPersisted(t *testing.T) {
	fixture := setupFileOperationTest(t)
	bt := treenode.GetBlockTree(fixture.sourceID)
	if err := verifyShorthandDocPersisted(bt, fixture.sourceID); nil != err {
		t.Fatalf("verify persisted shorthand document failed: %v", err)
	}

	docPath := filepath.Join(util.DataDir, fixture.box.ID, bt.Path)
	if err := os.Remove(docPath); nil != err {
		t.Fatalf("remove persisted document failed: %v", err)
	}
	if err := verifyShorthandDocPersisted(bt, fixture.sourceID); nil == err {
		t.Fatal("expected missing persisted shorthand document to fail verification")
	}
}

func TestMoveLocalShorthandsKeepsSourceWhenAttachmentMoveFails(t *testing.T) {
	fixture := setupFileOperationTest(t)
	original := util.ShortcutsPath
	util.ShortcutsPath = t.TempDir()
	t.Cleanup(func() { util.ShortcutsPath = original })
	assets := filepath.Join(util.ShortcutsPath, "shorthands", "assets")
	if err := os.MkdirAll(assets, 0755); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(filepath.Dir(assets), "1788062238740.md")
	content := []byte("![image](assets/image.png)")
	if err := os.WriteFile(source, content, 0644); err != nil {
		t.Fatal(err)
	}
	attachment := filepath.Join(assets, "image.png")
	if err := os.WriteFile(attachment, []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	// A directory at the destination makes rename fail on every supported platform.
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets", "image.png"), 0755); err != nil {
		t.Fatal(err)
	}
	ids, err := MoveLocalShorthands(fixture.box.ID)
	if err == nil || len(ids) != 0 {
		t.Fatalf("attachment failure created documents: %v, %v", ids, err)
	}
	if got, err := os.ReadFile(source); err != nil || !bytes.Equal(got, content) {
		t.Fatalf("source changed: %q, %v", got, err)
	}
	if _, err := os.Stat(attachment); err != nil {
		t.Fatalf("attachment lost: %v", err)
	}
}
