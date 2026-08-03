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
	"errors"
	"path"
	"path/filepath"
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
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.BlockTreeDBPath = filepath.Join(tempDir, "blocktree.db")
	Conf = NewAppConf()
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
