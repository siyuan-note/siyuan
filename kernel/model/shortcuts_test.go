// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
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
