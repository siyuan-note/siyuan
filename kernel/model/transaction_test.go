// SiYuan - Refactor your thinking
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
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDoUpdateRejectsInvalidData(t *testing.T) {
	tests := []any{nil, 1, ""}
	for _, data := range tests {
		tx := &Transaction{}
		err := tx.doUpdate(&Operation{ID: "20260718000000-abcdefg", Data: data})
		if nil == err {
			t.Fatalf("expected invalid update data [%v] to be rejected", data)
		}
		if TxErrCodePushMsg != err.Code() {
			t.Fatalf("expected invalid update data [%v] to return code [%d], got [%d]", data, TxErrCodePushMsg, err.Code())
		}
	}
}

func TestTxErrFromPanic(t *testing.T) {
	if err := txErrFromPanic(1, "test"); nil == err {
		t.Fatal("expected an active transaction panic to return an error")
	}
	if err := txErrFromPanic(2, "test"); nil != err {
		t.Fatal("expected a committed transaction panic to preserve the committed result")
	}
}

func TestRecoverCalendarItemTransactionAfterPanic(t *testing.T) {
	oldRecover := recoverCalendarItemJournal
	t.Cleanup(func() { recoverCalendarItemJournal = oldRecover })
	calledWith := ""
	recoverCalendarItemJournal = func(boxID string) error {
		calledWith = boxID
		return nil
	}
	tx := &Transaction{calendarJournalBoxID: "20260728000000-boxabcd"}
	if err := recoverCalendarItemTransactionAfterPanic(tx); err != nil {
		t.Fatal(err)
	}
	if calledWith != tx.calendarJournalBoxID {
		t.Fatalf("panic recovery did not restore the calendar journal: got %q", calledWith)
	}
}

func TestDecodeAttributeViewItemUpdateDataFromReplayedJSON(t *testing.T) {
	data, err := decodeAttributeViewItemUpdateData(map[string]any{
		"AvID": "20260728000000-avabcde", "ItemID": "20260728000001-itemabc",
		"BoundBlockID": "20260728000002-docabcd", "PrimaryKey": "Restored title",
		"FieldValues": map[string]any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if data.AvID != "20260728000000-avabcde" || data.ItemID != "20260728000001-itemabc" ||
		data.BoundBlockID != "20260728000002-docabcd" || data.PrimaryKey != "Restored title" {
		t.Fatalf("replayed payload decoded incorrectly: %+v", data)
	}
}

func TestEmptyAttributeViewValueClearsWritableTypes(t *testing.T) {
	text := emptyAttributeViewValue(av.KeyTypeText)
	if text.Text == nil || text.Text.Content != "" {
		t.Fatalf("empty text value is invalid: %+v", text)
	}
	date := emptyAttributeViewValue(av.KeyTypeDate)
	if date.Date == nil || date.Date.IsNotEmpty || date.Date.IsNotEmpty2 {
		t.Fatalf("empty date value is invalid: %+v", date)
	}
	relation := emptyAttributeViewValue(av.KeyTypeRelation)
	if relation.Relation == nil || len(relation.Relation.BlockIDs) != 0 {
		t.Fatalf("empty relation value is invalid: %+v", relation)
	}
	attrView := &av.AttributeView{ID: "20260728000000-avabcde", KeyValues: []*av.KeyValues{{
		Key: &av.Key{ID: "20260728000001-relabcd", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "20260728000000-avabcde"}},
	}}}
	resolved, err := resolveCallerItemFieldValues(attrView, map[string]*av.Value{"20260728000001-relabcd": relation})
	resolvedRelation := resolved["20260728000001-relabcd"]
	if err != nil || resolvedRelation == nil || resolvedRelation.Relation == nil {
		t.Fatalf("explicit empty relation must remain writable: value=%+v err=%v", resolved, err)
	}
}

func TestAtomicAttributeViewOnlyUpdateBelongsToDocumentUndoStack(t *testing.T) {
	tx := &Transaction{trees: map[string]*parse.Tree{}, originalTrees: map[string]*parse.Tree{
		"20260728000002-docabcd": {ID: "20260728000002-docabcd"},
	}}
	ids := tx.GetMutatedRootIDs()
	if len(ids) != 1 || ids[0] != "20260728000002-docabcd" {
		t.Fatalf("atomic AV-only update lost its document undo root: %v", ids)
	}
}

func TestCalendarItemJournalRestoresBothPersistentFiles(t *testing.T) {
	oldReindex := reindexRecoveredCalendarItemTree
	reindexRecoveredCalendarItemTree = func(string, string) error { return nil }
	t.Cleanup(func() { reindexRecoveredCalendarItemTree = oldReindex })
	workspace := t.TempDir()
	oldDataDir, oldConfDir := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = filepath.Join(workspace, "data"), filepath.Join(workspace, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldDataDir, oldConfDir })

	boxID := "20260727000000-boxabcd"
	avID := "20260727000001-avabcde"
	docPath := "/20260727000002-docabcd.sy"
	docFile := filepath.Join(util.DataDir, boxID, docPath)
	avFile := filepath.Join(util.DataDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(docFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(avFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(docFile, []byte("new-document")); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(avFile, []byte("new-av")); err != nil {
		t.Fatal(err)
	}

	journal := &calendarItemCommitJournal{BoxID: boxID, DocPath: docPath, DocData: []byte("old-document"), AvID: avID, AvPath: avFile, AvData: []byte("old-av")}
	if err := persistCalendarItemCommitJournal(journal); err != nil {
		t.Fatal(err)
	}
	if err := recoverCalendarItemCommitJournal(boxID); err != nil {
		t.Fatal(err)
	}

	docData, _ := filelock.ReadFile(docFile)
	avData, _ := filelock.ReadFile(avFile)
	if !bytes.Equal(docData, journal.DocData) || !bytes.Equal(avData, journal.AvData) {
		t.Fatalf("journal recovery must restore both files, got doc=%q av=%q", docData, avData)
	}
	if _, err := os.Stat(calendarItemJournalPath(boxID)); !os.IsNotExist(err) {
		t.Fatalf("journal should be removed after recovery, stat error: %v", err)
	}
	cache.RemoveTreeData(util.GetTreeID(docPath))
	cache.RemoveAVDataInBox(avID, "")
}

func TestCalendarItemJournalRemovesPartialRenamedDocument(t *testing.T) {
	oldReindex := reindexRecoveredCalendarItemTree
	reindexRecoveredCalendarItemTree = func(string, string) error { return nil }
	t.Cleanup(func() { reindexRecoveredCalendarItemTree = oldReindex })
	workspace := t.TempDir()
	oldDataDir, oldConfDir := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = filepath.Join(workspace, "data"), filepath.Join(workspace, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldDataDir, oldConfDir })

	boxID := "20260727000000-boxabcd"
	docPath := "/20260727000002-docabcd.sy"
	newDocPath := "/20260727000002-newname.sy"
	avID := "20260727000001-avabcde"
	oldFile := filepath.Join(util.DataDir, boxID, docPath)
	newFile := filepath.Join(util.DataDir, boxID, newDocPath)
	avFile := filepath.Join(util.DataDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(oldFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(oldFile, []byte("old")); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(newFile, []byte("new")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(avFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(avFile, []byte("new-av")); err != nil {
		t.Fatal(err)
	}
	j := &calendarItemCommitJournal{BoxID: boxID, DocPath: docPath, NewDocPath: newDocPath, DocData: []byte("old"), AvID: avID, AvPath: avFile, AvData: []byte("av")}
	if err := persistCalendarItemCommitJournal(j); err != nil {
		t.Fatal(err)
	}
	if err := recoverCalendarItemCommitJournal(boxID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(newFile); !os.IsNotExist(err) {
		t.Fatalf("partial renamed document remains: %v", err)
	}
	data, err := filelock.ReadFile(oldFile)
	if err != nil || !bytes.Equal(data, []byte("old")) {
		t.Fatalf("old document was not restored: %q %v", data, err)
	}
}

func TestCalendarItemJournalRejectsTraversalPath(t *testing.T) {
	workspace := t.TempDir()
	oldDataDir, oldConfDir := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = filepath.Join(workspace, "data"), filepath.Join(workspace, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldDataDir, oldConfDir })
	boxID := "20260727000000-boxabcd"
	avID := "20260727000001-avabcde"
	avFile := filepath.Join(util.DataDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(avFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(avFile, []byte("av")); err != nil {
		t.Fatal(err)
	}
	j := &calendarItemCommitJournal{BoxID: boxID, DocPath: "/../outside.sy", DocData: []byte("old"), AvID: avID, AvPath: avFile, AvData: []byte("av")}
	if err := persistCalendarItemCommitJournal(j); err != nil {
		t.Fatal(err)
	}
	if err := recoverCalendarItemCommitJournal(boxID); err == nil {
		t.Fatal("journal traversal path must fail closed")
	}
}

func TestCalendarItemJournalRejectsCorruptRecordWithoutOverwritingData(t *testing.T) {
	workspace := t.TempDir()
	oldDataDir, oldConfDir := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = filepath.Join(workspace, "data"), filepath.Join(workspace, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldDataDir, oldConfDir })

	boxID := "20260727000000-boxabcd"
	journalPath := calendarItemJournalPath(boxID)
	if err := os.MkdirAll(filepath.Dir(journalPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := filelock.WriteFile(journalPath, []byte("not-json")); err != nil {
		t.Fatal(err)
	}
	if err := recoverCalendarItemCommitJournal(boxID); err == nil {
		t.Fatal("corrupt journal must fail closed")
	}
	if _, err := os.Stat(journalPath); err != nil {
		t.Fatalf("corrupt journal must remain for operator recovery: %v", err)
	}
}

func TestCalendarItemJournalPersistsBeforeAnyReplacementWrite(t *testing.T) {
	oldBuild := buildCalendarItemCommitJournal
	oldPersist, oldClear := persistCalendarItemCommitJournal, clearCalendarItemCommitJournal
	t.Cleanup(func() {
		buildCalendarItemCommitJournal = oldBuild
		persistCalendarItemCommitJournal, clearCalendarItemCommitJournal = oldPersist, oldClear
	})
	buildCalendarItemCommitJournal = func(*Transaction) (*calendarItemCommitJournal, error) {
		return &calendarItemCommitJournal{BoxID: "box", DocData: []byte("old-document"), AvData: []byte("old-av")}, nil
	}
	persisted := false
	persistCalendarItemCommitJournal = func(journal *calendarItemCommitJournal) error {
		persisted = journal != nil && len(journal.DocData) > 0 && len(journal.AvData) > 0
		return errors.New("stop after journal")
	}
	clearCalendarItemCommitJournal = func(string) error { return nil }

	tx := &Transaction{originalTrees: map[string]*parse.Tree{"doc": {Box: "box"}}, deferredAttrViews: map[string]*av.AttributeView{"av": {ID: "av"}}}
	if err := tx.commit(); err == nil || !persisted {
		t.Fatalf("commit must persist both old files before any replacement write, persisted=%v err=%v", persisted, err)
	}
}

func TestCalendarItemJournalClearsOnlyAfterIndexFlush(t *testing.T) {
	oldBuild := buildCalendarItemCommitJournal
	oldPersist := persistCalendarItemCommitJournal
	oldClear := clearCalendarItemCommitJournal
	oldFlush := flushCalendarItemIndexQueue
	t.Cleanup(func() {
		buildCalendarItemCommitJournal = oldBuild
		persistCalendarItemCommitJournal = oldPersist
		clearCalendarItemCommitJournal = oldClear
		flushCalendarItemIndexQueue = oldFlush
	})
	buildCalendarItemCommitJournal = func(*Transaction) (*calendarItemCommitJournal, error) {
		return &calendarItemCommitJournal{BoxID: "box", DocData: []byte("old-document"), AvData: []byte("old-av")}, nil
	}
	persistCalendarItemCommitJournal = func(*calendarItemCommitJournal) error { return nil }
	flushed := false
	flushCalendarItemIndexQueue = func() { flushed = true }
	clearCalendarItemCommitJournal = func(string) error {
		if !flushed {
			return errors.New("journal cleared before index flush")
		}
		return nil
	}
	if err := finalizeCalendarItemCommitJournal("box"); err != nil {
		t.Fatal(err)
	}
}

// TestCollectConsecutiveUpdateAttrViewCellOpsExecutesEachCellOnce 回归测试：
// 连续（同 AvID）的 updateAttrViewCell 操作必须被收集为同一个批量分组，不同 AvID 或
// 非单元格操作必须中断分组；按分组的长度推进遍历下标后，每个单元格操作恰好执行一次。
func TestCollectConsecutiveUpdateAttrViewCellOpsExecutesEachCellOnce(t *testing.T) {
	ops := []*Operation{
		{Action: "updateAttrViewCell", AvID: "av1", KeyID: "k1", RowID: "r1"},
		{Action: "updateAttrViewCell", AvID: "av1", KeyID: "k2", RowID: "r1"},
		{Action: "updateAttrViewCell", AvID: "av1", KeyID: "k3", RowID: "r2"},
		{Action: "sortAttrViewRow", AvID: "av1"},
		{Action: "updateAttrViewCell", AvID: "av2", KeyID: "k1", RowID: "r9"},
		{Action: "updateAttrViewCell", AvID: "av1", KeyID: "k4", RowID: "r3"},
	}

	var groups [][]*Operation
	for index := 0; index < len(ops); {
		group := collectConsecutiveUpdateAttrViewCellOps(ops, index)
		groups = append(groups, group)
		index += len(group)
	}

	seen := map[*Operation]int{}
	for _, group := range groups {
		for _, op := range group {
			seen[op]++
		}
	}
	for _, op := range ops {
		if "updateAttrViewCell" != op.Action {
			continue
		}
		if 1 != seen[op] {
			t.Fatalf("cell operation %s/%s executed %d times, want exactly once", op.KeyID, op.RowID, seen[op])
		}
	}
	if 2 != len(groups[0]) {
		t.Fatalf("first group must batch the two av1 cells, got %d", len(groups[0]))
	}
	if 1 != len(groups[1]) || "r2" != groups[1][0].RowID {
		t.Fatal("same-AvID but non-consecutive cell must form its own single group")
	}
	if "sortAttrViewRow" != groups[2][0].Action {
		t.Fatal("non-cell operation must break the batch and execute singly")
	}
	if 1 != len(groups[3]) || "av2" != groups[3][0].AvID {
		t.Fatal("different AvID must break the batch")
	}
	if 1 != len(groups[4]) || "r3" != groups[4][0].RowID {
		t.Fatal("later same-AvID cell must form its own group")
	}
}
