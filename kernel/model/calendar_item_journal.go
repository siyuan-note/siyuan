package model

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var buildCalendarItemCommitJournal = buildCalendarItemCommitJournal0
var persistCalendarItemCommitJournal = persistCalendarItemJournal
var clearCalendarItemCommitJournal = clearCalendarItemJournal
var reindexRecoveredCalendarItemTree = reindexRecoveredCalendarItemTree0
var flushCalendarItemIndexQueue = sql.FlushQueue
var recoverCalendarItemJournal = recoverCalendarItemCommitJournal

type calendarItemCommitJournal struct {
	BoxID      string `json:"boxID"`
	DocPath    string `json:"docPath"`
	NewDocPath string `json:"newDocPath,omitempty"`
	DocData    []byte `json:"docData"`
	AvID       string `json:"avID"`
	AvBoxID    string `json:"avBoxID"`
	AvPath     string `json:"avPath"`
	AvData     []byte `json:"avData"`
}

func calendarItemJournalPath(boxID string) string {
	if boxID != "" {
		return filepath.Join(util.DataDir, boxID, ".siyuan", "calendar-item-transaction.json")
	}
	return filepath.Join(util.ConfDir, "calendar-item-transaction.json")
}

func persistCalendarItemJournal(journal *calendarItemCommitJournal) error {
	if journal == nil {
		return nil
	}
	data, err := gulu.JSON.MarshalJSON(journal)
	if err != nil {
		return err
	}
	if journal.BoxID != "" && IsEncryptedBox(journal.BoxID) {
		dek, dekErr := GetDEKIfUnlocked(journal.BoxID)
		if dekErr != nil {
			return dekErr
		}
		key := util.DeriveSubKey(dek, "siyuan/calendar-item-transaction")
		data, err = util.EncryptWithAAD(key, data, []byte("siyuan:v1:calendar-item-transaction:"+journal.BoxID))
		if err != nil {
			return err
		}
	}
	journalPath := calendarItemJournalPath(journal.BoxID)
	if err = os.MkdirAll(filepath.Dir(journalPath), 0755); err != nil {
		return err
	}
	return filelock.WriteFile(journalPath, data)
}

func clearCalendarItemJournal(boxID string) error {
	err := filelock.Remove(calendarItemJournalPath(boxID))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func finalizeCalendarItemCommitJournal(boxID string) error {
	flushCalendarItemIndexQueue()
	return clearCalendarItemCommitJournal(boxID)
}

func recoverCalendarItemCommitJournal(boxID string) error {
	journalPath := calendarItemJournalPath(boxID)
	data, err := filelock.ReadFile(journalPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if boxID != "" && IsEncryptedBox(boxID) {
		if !IsBoxUnlocked(boxID) {
			// Leave the encrypted journal untouched until UnlockBox has loaded the DEK.
			return nil
		}
		dek, dekErr := GetDEKIfUnlocked(boxID)
		if dekErr != nil {
			return dekErr
		}
		key := util.DeriveSubKey(dek, "siyuan/calendar-item-transaction")
		data, err = util.DecryptWithAAD(key, data, []byte("siyuan:v1:calendar-item-transaction:"+boxID))
		if err != nil {
			return err
		}
	}
	journal := &calendarItemCommitJournal{}
	if err = gulu.JSON.UnmarshalJSON(data, journal); err != nil {
		return err
	}
	if journal.BoxID != boxID || journal.DocPath == "" || journal.AvID == "" {
		return errors.New("invalid calendar item transaction journal")
	}
	docRelative := strings.TrimPrefix(journal.DocPath, "/")
	cleanDocRelative := filepath.Clean(docRelative)
	if docRelative == journal.DocPath || cleanDocRelative == "." || cleanDocRelative == ".." ||
		strings.HasPrefix(cleanDocRelative, ".."+string(filepath.Separator)) || cleanDocRelative != docRelative || filepath.Ext(cleanDocRelative) != ".sy" {
		return errors.New("invalid calendar item document path")
	}
	journal.DocPath = "/" + cleanDocRelative
	if journal.NewDocPath != "" {
		newDocRelative := strings.TrimPrefix(journal.NewDocPath, "/")
		cleanNewDocRelative := filepath.Clean(newDocRelative)
		if newDocRelative == journal.NewDocPath || cleanNewDocRelative == "." || cleanNewDocRelative == ".." ||
			strings.HasPrefix(cleanNewDocRelative, ".."+string(filepath.Separator)) || cleanNewDocRelative != newDocRelative || filepath.Ext(cleanNewDocRelative) != ".sy" {
			return errors.New("invalid calendar item replacement document path")
		}
		journal.NewDocPath = "/" + cleanNewDocRelative
	}
	expectedAvPath, expectedAvBoxID := av.FindAttributeViewPathInBox(journal.AvID, journal.AvBoxID)
	if expectedAvPath == "" || filepath.Clean(expectedAvPath) != filepath.Clean(journal.AvPath) || expectedAvBoxID != journal.AvBoxID {
		return errors.New("invalid calendar item attribute view path")
	}
	if journal.NewDocPath != "" && journal.NewDocPath != journal.DocPath {
		if err = filelock.Remove(filepath.Join(util.DataDir, journal.BoxID, journal.NewDocPath)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if len(journal.DocData) > 0 {
		if err = filelock.WriteFile(filepath.Join(util.DataDir, journal.BoxID, journal.DocPath), journal.DocData); err != nil {
			return err
		}
	}
	if len(journal.AvData) > 0 && journal.AvPath != "" {
		if err = filelock.WriteFile(journal.AvPath, journal.AvData); err != nil {
			return err
		}
	}
	cache.RemoveTreeData(util.GetTreeID(journal.DocPath))
	cache.RemoveAVDataInBox(journal.AvID, journal.AvBoxID)
	if err = reindexRecoveredCalendarItemTree(journal.BoxID, journal.DocPath); err != nil {
		return err
	}
	ReloadAttrView(journal.AvID)
	ReloadFiletree()
	return finalizeCalendarItemCommitJournal(boxID)
}

func reindexRecoveredCalendarItemTree0(boxID, docPath string) error {
	tree, err := filesys.LoadTree(boxID, docPath, util.NewLute())
	if err != nil {
		return err
	}
	treenode.SetBlockTreePath(tree)
	sql.RenameTreeQueue(tree)
	return nil
}

func buildCalendarItemCommitJournal0(tx *Transaction) (*calendarItemCommitJournal, error) {
	if len(tx.originalTrees) != 1 || len(tx.deferredAttrViews) != 1 {
		return nil, errors.New("calendar item transaction requires exactly one document and one attribute view")
	}
	var treeID string
	var originalTreePath string
	for id, tree := range tx.originalTrees {
		treeID = id
		originalTreePath = tree.Path
		break
	}
	var avID string
	for id := range tx.deferredAttrViews {
		avID = id
		break
	}
	docPath := filepath.Join(util.DataDir, tx.originalTrees[treeID].Box, originalTreePath)
	docData, err := filelock.ReadFile(docPath)
	if err != nil {
		return nil, err
	}
	avPath, avBoxID := av.FindAttributeViewPath(avID)
	if avPath == "" {
		return nil, errors.New("attribute view file not found")
	}
	avData, err := filelock.ReadFile(avPath)
	if err != nil {
		return nil, err
	}
	newDocPath := ""
	if renamed, ok := tx.renamedTrees[treeID]; ok && renamed.Path != originalTreePath {
		newDocPath = renamed.Path
	}
	return &calendarItemCommitJournal{BoxID: tx.originalTrees[treeID].Box, DocPath: originalTreePath, NewDocPath: newDocPath, DocData: docData, AvID: avID, AvBoxID: avBoxID, AvPath: avPath, AvData: avData}, nil
}
