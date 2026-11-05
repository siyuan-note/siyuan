// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package tools

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestToolFailureSemantics(t *testing.T) {
	const childEnv = "SIYUAN_TEST_MCP_FAILURE_SEMANTICS"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestToolFailureSemantics$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("failure semantics subprocess: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir = filepath.Join(root, "data"), filepath.Join(root, "temp")
	util.ConfDir, util.HistoryDir = filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath, util.AssetContentDBPath = filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	defer treenode.CloseDatabase()
	boxID, docID, missingID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Tool semantics", "Tool semantics")
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	assertResult := func(name string, result CallToolResult, err error, isError bool, text string) {
		t.Helper()
		if err != nil || result.IsError != isError || len(result.Content) != 1 || !strings.Contains(result.Content[0].Text, text) {
			t.Fatalf("%s: got %+v, %v; want error=%v and %q", name, result, err, isError, text)
		}
	}
	for _, id := range []string{missingID, "invalid-id"} {
		result, err := attrGet(map[string]any{"id": id})
		assertResult("missing attributes", result, err, true, "block not found: "+id)
		result, err = refRefresh(map[string]any{"id": id})
		assertResult("missing reference target", result, err, true, "block not found: "+id)
		result, err = outlineGet(map[string]any{"id": id})
		assertResult("missing outline", result, err, true, "document not found: "+id)
	}
	result, err := refRefresh(map[string]any{})
	assertResult("missing reference ID", result, err, true, "id is required")
	result, err = refRefresh(map[string]any{"id": docID})
	assertResult("existing reference target", result, err, false, "backlink refreshed for: "+docID)
	result, err = outlineGet(map[string]any{"id": docID})
	assertResult("empty outline", result, err, false, "document has no headings")

	result, err = attrGet(map[string]any{"id": docID})
	assertResult("no custom attributes", result, err, false, "Attributes for "+docID)
	result, err = attrBatchGet(map[string]any{"ids": docID + ", " + missingID})
	assertResult("mixed attribute batch", result, err, true, "block not found: "+missingID)
	if !strings.Contains(result.Content[0].Text, "--- "+docID+" ---") || !strings.Contains(result.Content[0].Text, "- id: "+docID) {
		t.Fatalf("mixed batch omitted the existing block: %+v", result)
	}
	result, err = attrBatchGet(map[string]any{"ids": missingID})
	assertResult("missing attribute batch", result, err, true, "block not found: "+missingID)
	result, err = attrBatchGet(map[string]any{"ids": docID})
	assertResult("batch without custom attributes", result, err, false, "- id: "+docID)
	result, err = attrBatchGet(map[string]any{"ids": docID + ", " + docID})
	assertResult("duplicate attribute IDs", result, err, false, "Batch attributes (1 blocks)")
	tree.Root.SetIALAttr("custom-test", "value")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	cache.RemoveBlockIAL(docID)
	cache.RemoveBlockIALInBox(docID, boxID)
	result, err = attrGet(map[string]any{"id": docID})
	assertResult("populated attributes", result, err, false, "- custom-test: value")
	result, err = attrBatchGet(map[string]any{"ids": missingID + "," + docID})
	assertResult("mixed populated attribute batch", result, err, true, "block not found: "+missingID)
	if !strings.Contains(result.Content[0].Text, "- custom-test: value") {
		t.Fatalf("mixed batch omitted successful attributes: %+v", result)
	}
	for _, ids := range []string{" ", docID + ",", "," + docID} {
		result, err = attrBatchGet(map[string]any{"ids": ids})
		assertResult("empty batch ID", result, err, true, "non-empty block IDs")
	}

	heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
	tree.Root.AppendChild(heading)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	result, err = outlineGet(map[string]any{"id": docID})
	assertResult("populated outline", result, err, false, "Document outline (1 headings)")
	if !strings.Contains(result.Content[0].Text, "Heading") {
		t.Fatal("outline omitted heading text", result)
	}
	heading.Unlink()
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	result, err = attrGet(map[string]any{"id": heading.ID})
	assertResult("stale block attributes", result, err, true, "block not found: "+heading.ID)
	result, err = refRefresh(map[string]any{"id": heading.ID})
	assertResult("stale reference target", result, err, true, "block not found: "+heading.ID)

	// 保留索引但移除文件，读取失败不能作为空属性或空大纲返回。
	if err := os.Remove(filepath.Join(util.DataDir, boxID, tree.Path)); err != nil {
		t.Fatal(err)
	}
	result, err = attrGet(map[string]any{"id": docID})
	assertResult("unreadable attributes", result, err, true, "load block")
	result, err = refRefresh(map[string]any{"id": docID})
	assertResult("unreadable reference target", result, err, true, "load block")
	result, err = outlineGet(map[string]any{"id": docID})
	assertResult("unreadable outline", result, err, true, "outline failed")
	otherID := ast.NewNodeID()
	other := treenode.NewTree(boxID, "/"+otherID+".sy", "/Readable", "Readable")
	other.Root.SetIALAttr("custom-readable", "preserved")
	if _, err := filesys.WriteTree(other); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(other)
	result, err = attrBatchGet(map[string]any{"ids": docID + "," + otherID})
	assertResult("mixed unreadable attribute batch", result, err, true, "load block "+docID+" failed")
	if !strings.Contains(result.Content[0].Text, "- custom-readable: preserved") {
		t.Fatalf("read failure discarded the readable block: %+v", result)
	}
}
