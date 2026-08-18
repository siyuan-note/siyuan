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

//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const setDocSortModeTestEnv = "SIYUAN_TEST_SET_DOC_SORT_MODE"

func TestSetDocSortModeValidationAndPersistence(t *testing.T) {
	if "1" != os.Getenv(setDocSortModeTestEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSetDocSortModeValidationAndPersistence$", "-test.v")
		cmd.Env = append(os.Environ(), setDocSortModeTestEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("set document sort mode subprocess failed: %v\n%s", err, output)
		}
		return
	}

	fixture := setupFileOperationTest(t)
	originalTempDir := util.TempDir
	originalQueueDir := util.QueueDir
	originalConfDir := util.ConfDir
	originalDBPath := util.DBPath
	originalHistoryDBPath := util.HistoryDBPath
	originalAssetContentDBPath := util.AssetContentDBPath
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.ConfDir = filepath.Join(util.TempDir, "conf")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.QueueDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); nil != err {
			t.Fatalf("create test directory [%s] failed: %v", dir, err)
		}
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	for _, p := range []string{fixture.sourcePath, fixture.targetPath} {
		tree, loadErr := filesys.LoadTree(fixture.box.ID, p, util.NewLute())
		if nil != loadErr {
			t.Fatalf("reload fixture document [%s] failed: %v", p, loadErr)
		}
		treenode.UpsertBlockTree(tree)
	}
	t.Cleanup(func() {
		sql.CloseDatabase()
		util.TempDir = originalTempDir
		util.QueueDir = originalQueueDir
		util.ConfDir = originalConfDir
		util.DBPath = originalDBPath
		util.HistoryDBPath = originalHistoryDBPath
		util.AssetContentDBPath = originalAssetContentDBPath
	})
	if warmed := fixture.box.docIAL(fixture.sourcePath); nil == warmed {
		t.Fatal("failed to warm source document IAL cache")
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("load source document failed: %v", err)
	}
	updated := tree.Root.IALAttr("updated")
	mode := util.SortModeSubDocCountDESC
	result, err := SetDocSortMode(fixture.sourceID, &mode)
	if nil != err {
		t.Fatalf("set document sort mode failed: %v", err)
	}
	if result.ID != fixture.sourceID || nil == result.SortMode || mode != *result.SortMode || mode != result.EffectiveSortMode {
		t.Fatalf("unexpected set document sort mode result: %#v", result)
	}
	if immediate := fixture.box.docIAL(fixture.sourcePath); "14" != immediate[DocSortModeAttr] {
		t.Fatalf("immediate document IAL read returned a stale sort mode: %q", immediate[DocSortModeAttr])
	}
	resolvedMode, resolveErr := ResolveDocTreeSortMode(fixture.box.ID, fixture.sourcePath)
	if nil != resolveErr || mode != resolvedMode {
		t.Fatalf("immediate sort mode resolution returned mode=%d, err=%v", resolvedMode, resolveErr)
	}

	tree, err = LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("reload source document failed: %v", err)
	}
	if tree.Root.IALAttr(DocSortModeAttr) != "14" {
		t.Fatalf("document sort mode was not persisted: %q", tree.Root.IALAttr(DocSortModeAttr))
	}
	if tree.Root.IALAttr("updated") != updated {
		t.Fatalf("setting document sort mode changed updated: got %q, want %q", tree.Root.IALAttr("updated"), updated)
	}

	for _, invalid := range []int{-1, util.SortModeFileTree, util.SortModeUnassigned} {
		if _, setErr := SetDocSortMode(fixture.sourceID, &invalid); nil == setErr {
			t.Fatalf("invalid document sort mode [%d] was accepted", invalid)
		}
	}
	if err = SetBlockAttrs(fixture.sourceID, map[string]string{DocSortModeAttr: "15"}); nil == err {
		t.Fatal("generic block attribute API accepted an invalid document sort mode")
	}
	if err = SetBlockAttrs(fixture.childID, map[string]string{DocSortModeAttr: "1"}); nil == err {
		t.Fatal("generic block attribute API accepted a document sort mode on a non-document block")
	}

	clearResult, err := SetDocSortMode(fixture.sourceID, nil)
	if nil != err {
		t.Fatalf("remove document sort mode failed: %v", err)
	}
	if nil != clearResult.SortMode || Conf.FileTree.Sort != clearResult.EffectiveSortMode {
		t.Fatalf("cleared document sort mode did not inherit the global mode: %#v", clearResult)
	}
	tree, err = LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("reload source document after removing sort mode failed: %v", err)
	}
	if "" != tree.Root.IALAttr(DocSortModeAttr) {
		t.Fatalf("document sort mode was not removed: %q", tree.Root.IALAttr(DocSortModeAttr))
	}
}
