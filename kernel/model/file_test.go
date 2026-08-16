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
	"errors"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type fileOperationTestFixture struct {
	box        *Box
	sourcePath string
	targetPath string
	sourceID   string
	childID    string
}

func setupFileOperationTest(t *testing.T) *fileOperationTestFixture {
	originalConf := Conf
	originalDataDir := util.DataDir
	originalBlockTreeDBPath := util.BlockTreeDBPath
	const testLang = "file-operation-test"
	originalTimeLang, hadTimeLang := util.TimeLangs[testLang]
	util.TimeLangs[testLang] = map[string]any{
		"albl": "ago", "blbl": "from now", "now": "now", "1s": "1 second %s", "xs": "%d seconds %s",
		"1m": "1 minute %s", "xm": "%d minutes %s", "1h": "1 hour %s", "xh": "%d hours %s", "1d": "1 day %s",
		"xd": "%d days %s", "1w": "1 week %s", "xw": "%d weeks %s", "1M": "1 month %s", "xM": "%d months %s",
		"1y": "1 year %s", "2y": "2 years %s", "xy": "%d years %s", "max": "a long while %s",
	}
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.BlockTreeDBPath = filepath.Join(tempDir, "blocktree.db")
	Conf = NewAppConf()
	Conf.Lang = testLang
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()

	box := &Box{ID: "20260718000000-abcdefg"}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "File operation test"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save test notebook conf failed: %v", err)
	}

	treenode.InitBlockTree(true)
	sourcePath := "/20260718000001-abcdefg.sy"
	targetPath := "/20260718000002-abcdefg.sy"
	sourceTree := treenode.NewTree(box.ID, sourcePath, "/Source", "Source")
	targetTree := treenode.NewTree(box.ID, targetPath, "/Target", "Target")
	for _, tree := range []*parse.Tree{sourceTree, targetTree} {
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write test tree failed: %v", err)
		}
		treenode.UpsertBlockTree(tree)
	}

	t.Cleanup(func() {
		cache.RemoveTreeData(sourceTree.ID)
		cache.RemoveTreeData(targetTree.ID)
		cache.RemoveDocIAL(sourceTree.Path)
		cache.RemoveDocIAL(targetTree.Path)
		treenode.CloseDatabase()
		if hadTimeLang {
			util.TimeLangs[testLang] = originalTimeLang
		} else {
			delete(util.TimeLangs, testLang)
		}
		Conf = originalConf
		util.DataDir = originalDataDir
		util.BlockTreeDBPath = originalBlockTreeDBPath
		if "" != originalBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	return &fileOperationTestFixture{
		box:        box,
		sourcePath: sourcePath,
		targetPath: targetPath,
		sourceID:   sourceTree.ID,
		childID:    sourceTree.Root.FirstChild.ID,
	}
}

func TestResolveDocTreeSortModeInheritance(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeSizeDESC
	boxConf := fixture.box.GetConf()
	boxConf.SortMode = util.SortModeCreatedASC
	if err := fixture.box.SaveConf(boxConf); nil != err {
		t.Fatalf("save notebook sort mode failed: %v", err)
	}

	parentTree, err := LoadTreeByBlockID(util.GetTreeID(fixture.targetPath))
	if nil != err {
		t.Fatalf("load parent document failed: %v", err)
	}
	parentTree.Root.SetIALAttr(DocSortModeAttr, "3")
	if _, err = filesys.WriteTree(parentTree); nil != err {
		t.Fatalf("write parent document sort mode failed: %v", err)
	}
	treenode.UpsertBlockTree(parentTree)

	childID := "20260718000003-abcdefg"
	childPath := strings.TrimSuffix(parentTree.Path, ".sy") + "/" + childID + ".sy"
	childTree := treenode.NewTree(fixture.box.ID, childPath, parentTree.HPath+"/Child", "Child")
	if _, err = filesys.WriteTree(childTree); nil != err {
		t.Fatalf("write child document failed: %v", err)
	}
	treenode.UpsertBlockTree(childTree)
	t.Cleanup(func() {
		cache.RemoveTreeData(childTree.ID)
		cache.RemoveDocIAL(childTree.Path)
	})

	for _, listPath := range []string{childTree.Path, strings.TrimSuffix(childTree.Path, ".sy")} {
		mode, resolveErr := ResolveDocTreeSortMode(fixture.box.ID, listPath)
		if nil != resolveErr {
			t.Fatalf("resolve inherited sort mode for [%s] failed: %v", listPath, resolveErr)
		}
		if util.SortModeUpdatedDESC != mode {
			t.Fatalf("unexpected inherited sort mode for [%s]: got %d, want %d", listPath, mode, util.SortModeUpdatedDESC)
		}
	}

	childTree.Root.SetIALAttr(DocSortModeAttr, "6")
	if _, err = filesys.WriteTree(childTree); nil != err {
		t.Fatalf("write child document override failed: %v", err)
	}
	cache.RemoveDocIALInBox(childTree.Path, childTree.Box)
	mode, err := ResolveDocTreeSortMode(fixture.box.ID, childTree.Path)
	if nil != err || util.SortModeCustom != mode {
		t.Fatalf("child override was not resolved: mode=%d, err=%v", mode, err)
	}

	mode, err = ResolveDocTreeSortMode(fixture.box.ID, "/")
	if nil != err || util.SortModeCreatedASC != mode {
		t.Fatalf("notebook fallback was not resolved: mode=%d, err=%v", mode, err)
	}
	boxConf.SortMode = util.SortModeFileTree
	if err = fixture.box.SaveConf(boxConf); nil != err {
		t.Fatalf("save notebook inherited sort mode failed: %v", err)
	}
	mode, err = ResolveDocTreeSortMode(fixture.box.ID, "/")
	if nil != err || util.SortModeSizeDESC != mode {
		t.Fatalf("global fallback was not resolved: mode=%d, err=%v", mode, err)
	}

	files, _, err := ListDocTree(fixture.box.ID, "/", util.SortModeNameASC, false, false, 128)
	if nil != err {
		t.Fatalf("list root documents failed: %v", err)
	}
	for _, file := range files {
		if file.ID == parentTree.ID {
			if nil == file.ChildrenSortMode || util.SortModeUpdatedDESC != *file.ChildrenSortMode {
				t.Fatalf("parent declaration missing from listed file: %#v", file.ChildrenSortMode)
			}
			return
		}
	}
	t.Fatalf("parent document [%s] was not listed", parentTree.ID)
}

func TestCustomSortMaintenanceIgnoresEffectiveModeAndListLimit(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.FileTree.Sort = util.SortModeNameASC
	Conf.FileTree.MaxListCount = 1
	boxConf := fixture.box.GetConf()
	boxConf.SortMode = util.SortModeFileTree
	if err := fixture.box.SaveConf(boxConf); nil != err {
		t.Fatalf("save notebook sort mode failed: %v", err)
	}

	extraID := "20260718000003-abcdefg"
	extraPath := "/" + extraID + ".sy"
	extraTree := treenode.NewTree(fixture.box.ID, extraPath, "/Extra", "Extra")
	if _, err := filesys.WriteTree(extraTree); nil != err {
		t.Fatalf("write extra document failed: %v", err)
	}
	treenode.UpsertBlockTree(extraTree)
	t.Cleanup(func() {
		cache.RemoveTreeData(extraTree.ID)
		cache.RemoveDocIAL(extraTree.Path)
	})

	confPath := filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json")
	if err := writeSortConfMap(confPath, map[string]int{
		util.GetTreeID(fixture.targetPath): 10,
		fixture.sourceID:                   20,
		extraID:                            30,
	}); nil != err {
		t.Fatalf("write initial custom sort failed: %v", err)
	}

	maxID := "20260718000004-abcdefg"
	fixture.box.addMaxSort("/", maxID)
	sorts, err := readSortConfMap(confPath)
	if nil != err {
		t.Fatalf("read custom sort after append failed: %v", err)
	}
	if 31 != sorts[maxID] {
		t.Fatalf("append used effective display mode instead of custom order: got %d, want 31", sorts[maxID])
	}

	minID := "20260718000005-abcdefg"
	fixture.box.addMinSort("/", minID)
	sorts, err = readSortConfMap(confPath)
	if nil != err {
		t.Fatalf("read custom sort after prepend failed: %v", err)
	}
	if 9 != sorts[minID] {
		t.Fatalf("prepend used effective display mode instead of custom order: got %d, want 9", sorts[minID])
	}

	insertID := "20260718000006-abcdefg"
	fixture.box.addSort(fixture.sourcePath, insertID)
	sorts, err = readSortConfMap(confPath)
	if nil != err {
		t.Fatalf("read custom sort after adjacent insert failed: %v", err)
	}
	if 2 != sorts[insertID] || 3 != sorts[extraID] {
		t.Fatalf("adjacent insert was truncated by MaxListCount: insert=%d, trailing=%d", sorts[insertID], sorts[extraID])
	}
}

func TestGetDocOptionallyIncludesDocInfo(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	expected, err := GetDocInfo(fixture.sourceID)
	if nil != err {
		t.Fatalf("get standalone document info failed: %v", err)
	}

	_, _, _, _, rootID, _, _, _, boxID, _, _, _, _, embedded, err := GetDoc(
		"", "", fixture.sourceID, 0, "", nil, nil, 0, 0, 102400, false, map[string]string{}, true, true)
	if nil != err {
		t.Fatalf("get document with embedded info failed: %v", err)
	}
	if rootID != fixture.sourceID || boxID != fixture.box.ID {
		t.Fatalf("unexpected loaded document: root [%s], box [%s]", rootID, boxID)
	}
	if !reflect.DeepEqual(embedded, expected) {
		t.Fatalf("embedded document info differs from standalone result:\nembedded: %#v\nstandalone: %#v", embedded, expected)
	}

	_, _, _, _, _, _, _, _, _, _, _, _, _, omitted, err := GetDoc(
		"", "", fixture.sourceID, 0, "", nil, nil, 0, 0, 102400, false, map[string]string{}, true, false)
	if nil != err {
		t.Fatalf("get document without embedded info failed: %v", err)
	}
	if nil != omitted {
		t.Fatalf("document info should be omitted unless requested: %#v", omitted)
	}
}

func TestRemoveDocRejectsInvalidPath(t *testing.T) {
	fixture := setupFileOperationTest(t)

	if err := RemoveDoc(fixture.box.ID, "/_REPRO_FLAT"); !errors.Is(err, ErrBlockNotFound) {
		t.Fatalf("expected invalid document path to return ErrBlockNotFound, got [%v]", err)
	}
}

func TestValidateCreateDocDoesNotWrite(t *testing.T) {
	fixture := setupFileOperationTest(t)
	newID := "20260718000003-abcdefg"

	rootPath := "/" + newID + ".sy"
	if err := ValidateCreateDoc(fixture.box.ID, rootPath, "Root document"); err != nil {
		t.Fatalf("validate root document failed: %v", err)
	}
	if fixture.box.Exist(rootPath) {
		t.Fatalf("validation created root document [%s]", rootPath)
	}

	childPath := path.Join(strings.TrimSuffix(fixture.targetPath, ".sy"), newID+".sy")
	if err := ValidateCreateDoc(fixture.box.ID, childPath, "Child document"); err != nil {
		t.Fatalf("validate child document failed: %v", err)
	}
	if fixture.box.Exist(childPath) {
		t.Fatalf("validation created child document [%s]", childPath)
	}

	invalidChildPath := path.Join(fixture.targetPath, newID+".sy")
	if err := ValidateCreateDoc(fixture.box.ID, invalidChildPath, "Invalid child"); !errors.Is(err, ErrBlockNotFound) {
		t.Fatalf("expected parent path with .sy suffix to return ErrBlockNotFound, got [%v]", err)
	}

	wrongParentPath := path.Join(strings.TrimSuffix(fixture.sourcePath, ".sy"), strings.TrimSuffix(fixture.targetPath, ".sy"), newID+".sy")
	if err := ValidateCreateDoc(fixture.box.ID, wrongParentPath, "Wrong parent"); !errors.Is(err, ErrBlockNotFound) {
		t.Fatalf("expected mismatched parent path to return ErrBlockNotFound, got [%v]", err)
	}

	otherBox := &Box{ID: "20260718000004-abcdefg"}
	otherBoxConf := conf.NewBoxConf()
	otherBoxConf.Name = "Other file operation test"
	otherBoxConf.Closed = false
	if err := otherBox.SaveConf(otherBoxConf); err != nil {
		t.Fatalf("save other test notebook conf failed: %v", err)
	}
	crossBoxPath := path.Join(strings.TrimSuffix(fixture.targetPath, ".sy"), newID+".sy")
	if err := ValidateCreateDoc(otherBox.ID, crossBoxPath, "Cross notebook"); !errors.Is(err, ErrBlockNotFound) {
		t.Fatalf("expected cross-notebook parent to return ErrBlockNotFound, got [%v]", err)
	}
}

func TestValidateCreateDocReportsClosedNotebook(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxConf := fixture.box.GetConf()
	boxConf.Closed = true
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatalf("close test notebook failed: %v", err)
	}

	err := ValidateCreateDoc(fixture.box.ID, "/20260718000003-abcdefg.sy", "Closed notebook document")
	if !errors.Is(err, ErrBoxClosed) {
		t.Fatalf("expected closed notebook to return ErrBoxClosed, got [%v]", err)
	}
}

func TestCreateDocsByHPathUsesBoxDocAsLogicalRoot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxDocTree := treenode.NewTree(
		fixture.box.ID,
		"/"+fixture.box.ID+".sy",
		"/File operation test",
		"File operation test",
	)
	if _, err := filesys.WriteTree(boxDocTree); err != nil {
		t.Fatalf("write notebook document failed: %v", err)
	}
	treenode.UpsertBlockTree(boxDocTree)
	t.Cleanup(func() {
		for _, hPath := range []string{"/Direct reference", "/2026", "/2026/202608", "/2026/202608/Reference"} {
			if tree := treenode.GetBlockTreeRootByHPath(fixture.box.ID, hPath); nil != tree {
				cache.RemoveTreeData(tree.ID)
				cache.RemoveDocIAL(tree.Path)
			}
		}
		cache.RemoveTreeData(boxDocTree.ID)
		cache.RemoveDocIAL(boxDocTree.Path)
	})

	directDocID := "20260718000003-abcdefg"
	createdID, err := createDocsByHPath(
		fixture.box.ID,
		"/Direct reference",
		"",
		fixture.box.ID,
		directDocID,
		false,
	)
	if err != nil {
		t.Fatalf("create direct document from notebook document failed: %v", err)
	}
	if directDocID != createdID {
		t.Fatalf("unexpected direct document ID: got %s, want %s", createdID, directDocID)
	}
	directTree := treenode.GetBlockTree(directDocID)
	if nil == directTree {
		t.Fatalf("created direct document block tree [%s] not found", directDocID)
	}
	if "/Direct reference" != directTree.HPath || "/"+directDocID+".sy" != directTree.Path {
		t.Fatalf("unexpected direct document location: %+v", directTree)
	}

	docID := "20260718000004-abcdefg"
	createdID, err = createDocsByHPath(
		fixture.box.ID,
		"/2026/202608/Reference",
		"",
		fixture.box.ID,
		docID,
		false,
	)
	if err != nil {
		t.Fatalf("create document from notebook document failed: %v", err)
	}
	if docID != createdID {
		t.Fatalf("unexpected created document ID: got %s, want %s", createdID, docID)
	}

	createdTree := treenode.GetBlockTree(docID)
	if nil == createdTree {
		t.Fatalf("created document block tree [%s] not found", docID)
	}
	if "/2026/202608/Reference" != createdTree.HPath {
		t.Fatalf("unexpected created document path: got %s", createdTree.HPath)
	}
	if "/"+docID+".sy" == createdTree.Path {
		t.Fatalf("configured parent path was discarded: %s", createdTree.Path)
	}
}

func TestCreateDocsByHPathUsesExactParentDocument(t *testing.T) {
	tests := []struct {
		name  string
		title string
	}{
		{name: "non-breaking space", title: "Parent\u00a0Document"},
		{name: "zero-width joiner", title: "Parent \U0001F468\u200d\U0001F4BB"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			parentID := "20260718000005-abcdefg"
			parentPath := "/" + parentID + ".sy"
			parentTree := treenode.NewTree(fixture.box.ID, parentPath, "/"+test.title, test.title)
			if _, err := filesys.WriteTree(parentTree); err != nil {
				t.Fatalf("write parent document failed: %v", err)
			}
			treenode.UpsertBlockTree(parentTree)
			t.Cleanup(func() {
				cache.RemoveTreeData(parentTree.ID)
				cache.RemoveDocIAL(parentTree.Path)
			})

			childID := "20260718000006-abcdefg"
			createdID, err := createDocsByHPath(
				fixture.box.ID,
				parentTree.HPath+"/Child",
				"",
				parentID,
				childID,
				false,
			)
			if err != nil {
				t.Fatalf("create child document failed: %v", err)
			}
			if childID != createdID {
				t.Fatalf("unexpected child document ID: got %s, want %s", createdID, childID)
			}

			childTree := treenode.GetBlockTree(childID)
			if nil == childTree {
				t.Fatalf("created child document block tree [%s] not found", childID)
			}
			wantPath := strings.TrimSuffix(parentPath, ".sy") + "/" + childID + ".sy"
			if wantPath != childTree.Path {
				t.Fatalf("child document created under unexpected parent: got %s, want %s", childTree.Path, wantPath)
			}
		})
	}
}

func TestCreateDocsByHPathUsesParentIDForDuplicateHPath(t *testing.T) {
	fixture := setupFileOperationTest(t)
	title := "Parent\u00a0Document"
	var parents []*parse.Tree
	for _, parentID := range []string{"20260718000005-abcdefg", "20260718000006-abcdefg"} {
		parentPath := "/" + parentID + ".sy"
		parentTree := treenode.NewTree(fixture.box.ID, parentPath, "/"+title, title)
		if _, err := filesys.WriteTree(parentTree); err != nil {
			t.Fatalf("write parent document [%s] failed: %v", parentID, err)
		}
		treenode.UpsertBlockTree(parentTree)
		parents = append(parents, parentTree)
	}
	t.Cleanup(func() {
		for _, parentTree := range parents {
			cache.RemoveTreeData(parentTree.ID)
			cache.RemoveDocIAL(parentTree.Path)
		}
	})

	selectedParent := parents[1]
	childID := "20260718000007-abcdefg"
	_, err := createDocsByHPath(
		fixture.box.ID,
		selectedParent.HPath+"/Child",
		"",
		selectedParent.ID,
		childID,
		false,
	)
	if err != nil {
		t.Fatalf("create child document failed: %v", err)
	}

	childTree := treenode.GetBlockTree(childID)
	if nil == childTree {
		t.Fatalf("created child document block tree [%s] not found", childID)
	}
	wantPath := strings.TrimSuffix(selectedParent.Path, ".sy") + "/" + childID + ".sy"
	if wantPath != childTree.Path {
		t.Fatalf("child document created under unexpected duplicate parent: got %s, want %s", childTree.Path, wantPath)
	}
}

func TestCreateDocsByHPathKeepsHPathFallbackForDifferentParent(t *testing.T) {
	fixture := setupFileOperationTest(t)
	childID := "20260718000005-abcdefg"
	_, err := createDocsByHPath(
		fixture.box.ID,
		"/Target/Child",
		"",
		fixture.sourceID,
		childID,
		false,
	)
	if err != nil {
		t.Fatalf("create document by configured hpath failed: %v", err)
	}

	childTree := treenode.GetBlockTree(childID)
	if nil == childTree {
		t.Fatalf("created child document block tree [%s] not found", childID)
	}
	wantPath := strings.TrimSuffix(fixture.targetPath, ".sy") + "/" + childID + ".sy"
	if wantPath != childTree.Path {
		t.Fatalf("configured hpath fallback used unexpected parent: got %s, want %s", childTree.Path, wantPath)
	}
}

func TestGetBoxesByPathsStrictRejectsInvalidPaths(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tests := []struct {
		name  string
		paths []string
	}{
		{name: "empty", paths: nil},
		{name: "hpath", paths: []string{"/_REPRO_TEST/Sub_Note"}},
		{name: "hpath with extension", paths: []string{"/_REPRO_FLAT.sy"}},
		{name: "wrong parent", paths: []string{"/20260718000003-abcdefg/" + fixture.sourceID + ".sy"}},
		{name: "parent traversal", paths: []string{"/../" + fixture.sourceID + ".sy"}},
		{name: "child block", paths: []string{"/" + fixture.childID + ".sy"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := getBoxesByPathsStrict(test.paths); !errors.Is(err, ErrBlockNotFound) {
				t.Fatalf("expected invalid document paths [%v] to return ErrBlockNotFound, got [%v]", test.paths, err)
			}
		})
	}

	if _, err := getBoxesByPathsStrict([]string{strings.TrimPrefix(fixture.sourcePath, "/")}); err != nil {
		t.Fatalf("expected document path without leading slash to remain supported, got [%v]", err)
	}
}

func TestBlockTransactionRejectsDocumentMove(t *testing.T) {
	fixture := setupFileOperationTest(t)
	before := treenode.GetBlockTree(fixture.sourceID)
	if nil == before {
		t.Fatalf("source document block tree [%s] not found", fixture.sourceID)
	}

	tx := &Transaction{DoOperations: []*Operation{{
		Action:   "move",
		ID:       fixture.sourceID,
		ParentID: strings.TrimSuffix(path.Base(fixture.targetPath), ".sy"),
	}}}
	err := PerformTxSync(tx)
	if nil == err {
		t.Fatal("expected document move transaction to be rejected")
	}
	var txErr *TxErr
	if !errors.As(err, &txErr) {
		t.Fatalf("expected transaction error, got [%T] %v", err, err)
	}
	if TxErrCodePushMsg != txErr.Code() {
		t.Fatalf("unexpected transaction error code: got %d, want %d", txErr.Code(), TxErrCodePushMsg)
	}

	after := treenode.GetBlockTree(fixture.sourceID)
	if nil == after {
		t.Fatalf("source document block tree [%s] was removed", fixture.sourceID)
	}
	if before.RootID != after.RootID || before.ParentID != after.ParentID || before.BoxID != after.BoxID ||
		before.Path != after.Path || before.HPath != after.HPath || before.Type != after.Type {
		t.Fatalf("source document block tree changed: before [%+v], after [%+v]", before, after)
	}
	if !fixture.box.Exist(fixture.sourcePath) || !fixture.box.Exist(fixture.targetPath) {
		t.Fatal("document move transaction changed files on disk")
	}
}

func TestBlockTransactionRejectsDocumentPreviousSibling(t *testing.T) {
	fixture := setupFileOperationTest(t)
	before := treenode.GetBlockTree(fixture.childID)
	if nil == before {
		t.Fatalf("source block tree [%s] not found", fixture.childID)
	}

	tx := &Transaction{DoOperations: []*Operation{{
		Action:     "move",
		ID:         fixture.childID,
		ParentID:   fixture.sourceID,
		PreviousID: strings.TrimSuffix(path.Base(fixture.targetPath), ".sy"),
	}}}
	err := PerformTxSync(tx)
	if nil == err {
		t.Fatal("expected document previous sibling to be rejected")
	}
	var txErr *TxErr
	if !errors.As(err, &txErr) {
		t.Fatalf("expected transaction error, got [%T] %v", err, err)
	}
	if TxErrCodePushMsg != txErr.Code() {
		t.Fatalf("unexpected transaction error code: got %d, want %d", txErr.Code(), TxErrCodePushMsg)
	}

	after := treenode.GetBlockTree(fixture.childID)
	if nil == after {
		t.Fatalf("source block tree [%s] was removed", fixture.childID)
	}
	if before.RootID != after.RootID || before.ParentID != after.ParentID || before.BoxID != after.BoxID ||
		before.Path != after.Path || before.HPath != after.HPath || before.Type != after.Type {
		t.Fatalf("source block tree changed: before [%+v], after [%+v]", before, after)
	}
	if !fixture.box.Exist(fixture.sourcePath) || !fixture.box.Exist(fixture.targetPath) {
		t.Fatal("document previous sibling transaction changed files on disk")
	}
}

func TestMoveDocsRejectsInvalidPathsBeforeMoving(t *testing.T) {
	fixture := setupFileOperationTest(t)
	newPath := path.Join(strings.TrimSuffix(fixture.targetPath, ".sy"), fixture.sourceID+".sy")
	tests := []struct {
		name      string
		fromPaths []string
	}{
		{name: "hpath", fromPaths: []string{"/_REPRO_TEST/Sub_Note"}},
		{name: "mixed", fromPaths: []string{fixture.sourcePath, "/_REPRO_TEST/Sub_Note"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := MoveDocs(test.fromPaths, fixture.box.ID, fixture.targetPath, nil); !errors.Is(err, ErrBlockNotFound) {
				t.Fatalf("expected invalid source paths [%v] to return ErrBlockNotFound, got [%v]", test.fromPaths, err)
			}
			if !fixture.box.Exist(fixture.sourcePath) {
				t.Fatalf("source document was moved for invalid source paths [%v]", test.fromPaths)
			}
			if fixture.box.Exist(newPath) {
				t.Fatalf("target document was created for invalid source paths [%v]", test.fromPaths)
			}
		})
	}
}

func TestMoveDocsRefreshDeduplicatesParentsAndNotebooks(t *testing.T) {
	refresh := newMoveDocsRefresh()
	parent1 := &parse.Tree{Box: "20260718000000-abcdefg", ID: "20260718000001-abcdefg"}
	parent2 := &parse.Tree{Box: "20260718000002-abcdefg", ID: "20260718000001-abcdefg"}

	refresh.addParent(parent1)
	refresh.addParent(parent1)
	refresh.addParent(parent2)
	refresh.addNotebook(parent1.Box)
	refresh.addNotebook(parent1.Box)
	refresh.addNotebook(parent2.Box)

	parentCalls := map[moveDocsRefreshKey]int{}
	notebookCalls := map[string]int{}
	refresh.flushWith(func(tree *parse.Tree) {
		key := moveDocsRefreshKey{boxID: tree.Box, rootID: tree.ID}
		parentCalls[key]++
	}, func(boxID string) {
		notebookCalls[boxID]++
	})

	if 2 != len(parentCalls) {
		t.Fatalf("unexpected refreshed parent count: got %d, want 2", len(parentCalls))
	}
	for key, count := range parentCalls {
		if 1 != count {
			t.Fatalf("parent [%+v] refreshed %d times, want 1", key, count)
		}
	}
	if 2 != len(notebookCalls) {
		t.Fatalf("unexpected refreshed notebook count: got %d, want 2", len(notebookCalls))
	}
	for boxID, count := range notebookCalls {
		if 1 != count {
			t.Fatalf("notebook [%s] refreshed %d times, want 1", boxID, count)
		}
	}
}

func TestOrderMoveDocPathsPreservesInputOrder(t *testing.T) {
	box := &Box{ID: "20260810000000-abcdefg"}
	firstPath := "/20260810000001-abcdefg.sy"
	secondPath := "/20260810000002-abcdefg.sy"
	pathsBoxes := map[string]*Box{
		firstPath:  box,
		secondPath: box,
	}

	got := orderMoveDocPaths([]string{
		strings.TrimPrefix(secondPath, "/"),
		firstPath,
		secondPath,
	}, pathsBoxes)
	want := []string{secondPath, firstPath}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected ordered paths: got %v, want %v", got, want)
	}
}

func TestSetFileTreeSort(t *testing.T) {
	fixture := setupFileOperationTest(t)

	result, err := SetFileTreeSort(
		[]*SortItem{{ID: fixture.box.ID, Sort: -10}},
		[]*SortItem{{ID: fixture.sourceID, Sort: -8}},
	)
	if err != nil {
		t.Fatalf("set file tree sort failed: %v", err)
	}
	if len(result.NotebookIDs) != 1 || result.NotebookIDs[0] != fixture.box.ID {
		t.Fatalf("unexpected changed notebook IDs: %v", result.NotebookIDs)
	}
	if len(result.DocIDs) != 1 || result.DocIDs[0] != fixture.sourceID {
		t.Fatalf("unexpected changed document IDs: %v", result.DocIDs)
	}
	if sortVal := fixture.box.GetConf().Sort; sortVal != -10 {
		t.Fatalf("unexpected notebook sort: got %d, want -10", sortVal)
	}
	sortConfPath := filepath.Join(util.DataDir, fixture.box.ID, ".siyuan", "sort.json")
	sortValues, err := readSortConfMap(sortConfPath)
	if err != nil {
		t.Fatalf("read sort conf failed: %v", err)
	}
	if sortVal := sortValues[fixture.sourceID]; sortVal != -8 {
		t.Fatalf("unexpected document sort: got %d, want -8", sortVal)
	}

	result, err = SetFileTreeSort(
		[]*SortItem{{ID: fixture.box.ID, Sort: -10}},
		[]*SortItem{{ID: fixture.sourceID, Sort: -8}},
	)
	if err != nil {
		t.Fatalf("repeat file tree sort failed: %v", err)
	}
	if 0 != len(result.NotebookIDs) || 0 != len(result.DocIDs) {
		t.Fatalf("unchanged sorts reported changes: %+v", result)
	}
}

func TestSetFileTreeSortValidatesBeforeWriting(t *testing.T) {
	fixture := setupFileOperationTest(t)

	if _, err := SetFileTreeSort(
		[]*SortItem{{ID: fixture.box.ID, Sort: -10}},
		[]*SortItem{{ID: fixture.childID, Sort: -8}},
	); err == nil {
		t.Fatal("expected a child block ID to be rejected")
	}
	if sortVal := fixture.box.GetConf().Sort; sortVal != 0 {
		t.Fatalf("notebook sort changed before request validation completed: %d", sortVal)
	}
}

func TestSetFileTreeSortRejectsNotebookRootDocument(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxDocPath := "/" + fixture.box.ID + ".sy"
	boxDocTree := treenode.NewTree(fixture.box.ID, boxDocPath, "/File operation test", "File operation test")
	if _, err := filesys.WriteTree(boxDocTree); err != nil {
		t.Fatalf("write notebook root document failed: %v", err)
	}
	treenode.UpsertBlockTree(boxDocTree)
	t.Cleanup(func() {
		cache.RemoveTreeData(boxDocTree.ID)
		cache.RemoveDocIAL(boxDocTree.Path)
	})

	if _, err := SetFileTreeSort(
		[]*SortItem{{ID: fixture.box.ID, Sort: -10}},
		[]*SortItem{{ID: fixture.box.ID, Sort: -8}},
	); err == nil {
		t.Fatal("expected a notebook root document ID to be rejected")
	}
	if sortVal := fixture.box.GetConf().Sort; sortVal != 0 {
		t.Fatalf("notebook sort changed before notebook root document validation completed: %d", sortVal)
	}
}

func TestSetFileTreeSortRejectsDocumentInClosedNotebook(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxConf := fixture.box.GetConf()
	boxConf.Closed = true
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatalf("close test notebook failed: %v", err)
	}

	if _, err := SetFileTreeSort(nil, []*SortItem{{ID: fixture.sourceID, Sort: -8}}); err == nil {
		t.Fatal("expected a document in a closed notebook to be rejected")
	}
}

func TestSortSearchDocResults(t *testing.T) {
	results := []searchDocResult{
		{data: map[string]string{"hPath": "A/初中数学"}},
		{data: map[string]string{"hPath": "Z/数学"}, exact: true},
		{data: map[string]string{"hPath": "A/数学/"}, exact: true},
		{data: map[string]string{"hPath": "B/高等数学"}},
	}

	sortSearchDocResults(results)
	expected := []string{"A/数学/", "Z/数学", "A/初中数学", "B/高等数学"}
	for i, hPath := range expected {
		if hPath != results[i].data["hPath"] {
			t.Fatalf("unexpected search result order at %d: got %q, want %q", i, results[i].data["hPath"], hPath)
		}
	}
}

func TestSearchDocTextMatching(t *testing.T) {
	exactCases := []struct {
		name          string
		value         string
		keyword       string
		caseSensitive bool
		expected      bool
	}{
		{name: "same case sensitive", value: "Math", keyword: "Math", caseSensitive: true, expected: true},
		{name: "different case sensitive", value: "Math", keyword: "math", caseSensitive: true, expected: false},
		{name: "different case insensitive", value: "Math", keyword: "math", caseSensitive: false, expected: true},
	}
	for _, test := range exactCases {
		t.Run("exact/"+test.name, func(t *testing.T) {
			if actual := isExactSearchDocMatch(test.value, test.keyword, test.caseSensitive); test.expected != actual {
				t.Fatalf("unexpected exact match result: got %t, want %t", actual, test.expected)
			}
		})
	}

	containsCases := []struct {
		name          string
		value         string
		keywords      []string
		caseSensitive bool
		expected      bool
	}{
		{name: "same case sensitive", value: "Math Notes", keywords: []string{"Math"}, caseSensitive: true, expected: true},
		{name: "different case sensitive", value: "Math Notes", keywords: []string{"math"}, caseSensitive: true, expected: false},
		{name: "different case insensitive", value: "Math Notes", keywords: []string{"math"}, caseSensitive: false, expected: true},
		{name: "preserve any keyword matching", value: "Math Notes", keywords: []string{"missing", "notes"}, caseSensitive: false, expected: true},
	}
	for _, test := range containsCases {
		t.Run("contains/"+test.name, func(t *testing.T) {
			if actual := containsSearchDocKeyword(test.value, test.keywords, test.caseSensitive); test.expected != actual {
				t.Fatalf("unexpected contains result: got %t, want %t", actual, test.expected)
			}
		})
	}
}

func TestBuildSearchDocsCondition(t *testing.T) {
	condition, args := buildSearchDocsCondition([]string{"O'Reilly", "100%_done\\file"}, []string{"20260720000000-abc_def"}, true, true, true)
	if strings.Contains(condition, "O'Reilly") || strings.Contains(condition, "100%_done") {
		t.Fatalf("search condition should contain placeholders instead of keywords: %q", condition)
	}
	if placeholderCount := strings.Count(condition, "?"); placeholderCount != len(args) {
		t.Fatalf("search condition placeholder/arg mismatch: %d placeholders, %d args", placeholderCount, len(args))
	}

	expectedArgs := []string{
		"%O'Reilly%", "%O'Reilly%", "%O'Reilly%", "%O'Reilly%",
		"%100\\%\\_done\\\\file%", "%100\\%\\_done\\\\file%", "%100\\%\\_done\\\\file%", "%100\\%\\_done\\\\file%",
		"%20260720000000-abc\\_def%",
	}
	for i, expected := range expectedArgs {
		if actual := args[i].(string); expected != actual {
			t.Fatalf("unexpected search arg at %d: got %q, want %q", i, actual, expected)
		}
	}
}

func TestBuildSearchDocsConditionBindsInjectionPayload(t *testing.T) {
	payload := "poc%')/**/union/**/select/**/'poc'--"
	condition, args := buildSearchDocsCondition([]string{payload}, nil, true, true, true)
	if strings.Contains(condition, payload) || strings.Contains(strings.ToLower(condition), "union") {
		t.Fatalf("search condition should not contain payload SQL: %q", condition)
	}

	expected := "%" + escapeSearchDocLikePattern(payload) + "%"
	if len(args) != 4 {
		t.Fatalf("unexpected search arg count: got %d, want 4", len(args))
	}
	for i, arg := range args {
		if actual := arg.(string); expected != actual {
			t.Fatalf("unexpected search arg at %d: got %q, want %q", i, actual, expected)
		}
	}
}
