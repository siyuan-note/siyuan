// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"errors"
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewSourceRecorderIncludesReloadsAndPreservesConditions(t *testing.T) {
	setupCollectionIndexTest(t)
	oldLang, oldAVLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldAVLangs })
	view := NewAttributeView(ast.NewNodeID())
	if err := SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	filename := GetAttributeViewDataPath(view.ID)
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	injected := errors.New("injected recovery recorder failure")
	reject := false
	release := RecordSourceWrites(view, func() bool { return true }, func(_ string, before, after []byte) error {
		calls++
		if len(before) == 0 || len(after) == 0 {
			t.Fatal("missing exact source bytes")
		}
		if reject {
			return injected
		}
		return nil
	})
	defer release()
	reloaded, err := ParseAttributeView(view.ID)
	if err != nil {
		t.Fatal(err)
	}
	reloaded.Name = "Changed"
	if err = SaveAttributeView(reloaded); err != nil || calls != 1 {
		t.Fatal("reloaded view bypassed recorder", err, calls)
	}
	current, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	reloaded.Name = "Stale conditional change"
	if err = SaveAttributeViewIfUnchanged(reloaded, original); !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("recorder bypassed conditional write", err)
	}
	reject = true
	if err = SaveAttributeView(reloaded); !errors.Is(err, injected) {
		t.Fatal("recorder failure did not stop source write", err)
	}
	actual, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(actual, current) {
		t.Fatal("rejected write changed source", err)
	}
	release()
	if err = SaveAttributeView(reloaded); err != nil {
		t.Fatal("released recorder remained active", err)
	}
}
