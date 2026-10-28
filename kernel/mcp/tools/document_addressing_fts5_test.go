// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package tools

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentStructuredAddressing(t *testing.T) {
	const childEnv = "SIYUAN_TEST_MCP_DOCUMENT_ADDRESSING"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDocumentStructuredAddressing$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("document addressing subprocess: %v\n%s", err, output)
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
	model.Conf.Lang = "mcp-document-test"
	util.TimeLangs[model.Conf.Lang] = map[string]any{
		"albl": "ago", "blbl": "from now", "now": "now", "1s": "1 second %s", "xs": "%d seconds %s",
		"1m": "1 minute %s", "xm": "%d minutes %s", "1h": "1 hour %s", "xh": "%d hours %s", "1d": "1 day %s",
		"xd": "%d days %s", "1w": "1 week %s", "xw": "%d weeks %s", "1M": "1 month %s", "xM": "%d months %s",
		"1y": "1 year %s", "2y": "2 years %s", "xy": "%d years %s", "max": "a long while %s",
	}
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
	box := &model.Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "MCP documents", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	createFixture := func(parent *parse.Tree, title string) *parse.Tree {
		id, folder, hPath := ast.NewNodeID(), "/", ""
		if parent != nil {
			folder, hPath = strings.TrimSuffix(parent.Path, ".sy"), parent.HPath
		}
		tree := treenode.NewTree(box.ID, path.Join(folder, id+".sy"), hPath+"/"+title, title)
		if err := os.MkdirAll(filepath.Dir(filepath.Join(util.DataDir, box.ID, tree.Path)), 0755); err != nil {
			t.Fatal(err)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.UpsertTreeQueue(tree)
		sql.FlushQueue()
		return tree
	}
	literal := createFixture(nil, "A/B")
	parent := createFixture(nil, "A")
	child := createFixture(parent, "B")
	source := createFixture(nil, "Move me")
	if literal.HPath != child.HPath {
		t.Fatal("fixture does not contain a display-path collision")
	}
	before, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, source.Path))
	for _, action := range []string{"create", "list", "move"} {
		hPath := "/A/B"
		if action == "create" {
			hPath += "/New"
		}
		args := map[string]any{"action": action, "notebook": box.ID, "path": hPath, "id": source.ID, "title": "New"}
		result, err := documentHandler(args)
		if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, "pathAmbiguous") {
			t.Fatalf("%s: %+v %v", action, result, err)
		}
	}
	if target, err := resolveDocumentTarget(box.ID, map[string]any{"path": "/Move me"}, false, false); err != nil || target.path != source.Path {
		t.Fatal(target, err)
	}
	if target, err := resolveDocumentTarget(box.ID, map[string]any{"path": "/"}, false, false); err != nil || target.path != "/" {
		t.Fatal(target, err)
	}
	after, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, source.Path))
	if !bytes.Equal(before, after) {
		t.Fatal("rejected move changed the source")
	}
	for _, selected := range []*parse.Tree{literal, child} {
		target, err := resolveDocumentTarget(box.ID, map[string]any{"parentID": selected.ID}, false, false)
		if err != nil || target.path != selected.Path || target.id == nil || *target.id != selected.ID {
			t.Fatalf("parent identity was resolved through its display path: %+v, %v", target, err)
		}
	}
	for _, invalid := range []map[string]any{
		{"parentID": literal.ID, "path": "/A/B"}, {"parentID": nil}, {"parentID": 1},
		{"parentID": "invalid"}, {"parentID": ast.NewNodeID()}, {"parentID": literal.Root.FirstChild.ID},
	} {
		if target, err := resolveDocumentTarget(box.ID, invalid, false, false); err == nil {
			t.Fatalf("invalid target silently selected a parent: %+v", target)
		}
	}
	result, err := documentCreate(map[string]any{"notebook": box.ID, "parentID": literal.ID, "title": "Literal/child", "markdown": "Body"})
	if err != nil || result.IsError {
		t.Fatalf("structured creation failed: %+v, %v", result, err)
	}
	created := strings.Fields(result.Content[0].Text)[2]
	docs, missing, err := model.GetDocPaths(box.ID, []string{created})
	if err != nil || len(missing) != 0 || len(docs) != 1 || docs[0].ParentID == nil || *docs[0].ParentID != literal.ID || docs[0].Title.Text != "Literal/child" {
		t.Fatalf("created in the wrong location: %+v, %v", docs, err)
	}
	listed, err := documentList(map[string]any{"notebook": box.ID, "parentID": literal.ID})
	if err != nil || listed.IsError || !strings.Contains(listed.Content[0].Text, created) {
		t.Fatalf("ID-based listing failed: %+v, %v", listed, err)
	}
	moved, err := documentMove(map[string]any{"notebook": box.ID, "parentID": child.ID, "id": source.ID})
	if err != nil || moved.IsError {
		t.Fatalf("ID-based move failed: %+v, %v", moved, err)
	}
	docs, _, err = model.GetDocPaths(box.ID, []string{source.ID})
	if err != nil || len(docs) != 1 || docs[0].ParentID == nil || *docs[0].ParentID != child.ID {
		t.Fatalf("moved to the wrong colliding parent: %+v, %v", docs, err)
	}
	rootTarget, err := resolveDocumentTarget(box.ID, map[string]any{"parentID": ""}, false, false)
	if err != nil || rootTarget.path != "/" || rootTarget.id != nil {
		t.Fatalf("explicit root target failed: %+v, %v", rootTarget, err)
	}
	defaultTarget, err := resolveDocumentTarget(box.ID, map[string]any{}, false, true)
	if err != nil || defaultTarget.path != "/" {
		t.Fatalf("default root listing failed: %+v, %v", defaultTarget, err)
	}
	if result, err = documentCreate(map[string]any{"notebook": box.ID, "parentID": ""}); err != nil || !result.IsError {
		t.Fatal("structured creation without an explicit title was accepted", result, err)
	}
	if _, err := resolveDocumentTarget(box.ID, map[string]any{"path": ""}, false, true); err != nil {
		t.Fatal("empty listing path no longer selects root", err)
	}
	foreign := &model.Box{ID: ast.NewNodeID()}
	if err := foreign.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveDocumentTarget(foreign.ID, map[string]any{"parentID": literal.ID}, false, false); err == nil {
		t.Fatal("parent from a different notebook was accepted")
	}
	// Content is committed before saving sort.json. Preserve that identity on failure.
	sortPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	if err := os.Remove(sortPath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sortPath, 0755); err != nil {
		t.Fatal(err)
	}
	failed, err := documentCreate(map[string]any{"notebook": box.ID, "parentID": "", "title": "Committed despite sort failure", "markdown": "retained body"})
	if err != nil || !failed.IsError || !failed.HasStructuredContent() {
		t.Fatalf("creation failure lost metadata: %+v, %v", failed, err)
	}
	var metadata struct {
		ID          string   `json:"id"`
		CommitState string   `json:"commitState"`
		Stage       string   `json:"stage"`
		Completed   []string `json:"completed"`
	}
	if err := json.Unmarshal([]byte(failed.Content[0].Text), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.CommitState != "committed" || metadata.Stage != "sort" || !ast.IsNodeIDPattern(metadata.ID) || len(metadata.Completed) != 1 || metadata.Completed[0] != "source" {
		t.Fatalf("incorrect failure metadata: %+v", metadata)
	}
	if _, err := filesys.ReadDocumentMetadataTree(box.ID, "/"+metadata.ID+".sy"); err != nil {
		t.Fatal("returned ID does not identify the committed document", err)
	}
	if err := os.Remove(sortPath); err != nil {
		t.Fatal(err)
	}
	// Clean legacy paths use the same ready metadata checks as structured paths.
	legacyBox := ast.NewNodeID()
	if err := (&model.Box{ID: legacyBox}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	legacyDoc := treenode.NewTree(legacyBox, "/"+ast.NewNodeID()+".sy", "/Legacy", "Legacy")
	treenode.UpsertBlockTree(legacyDoc)
	if err := treenode.SetDocumentMetadataState(legacyBox, "ready"); err != nil {
		t.Fatal(err)
	}
	for _, create := range []bool{false, true} {
		hPath := "/Legacy"
		if create {
			hPath += "/New"
		}
		target, err := resolveDocumentTarget(legacyBox, map[string]any{"path": hPath}, create, false)
		if err != nil || target.structured || target.path != legacyDoc.Path {
			t.Fatalf("legacy path behavior changed: %+v, %v", target, err)
		}
	}
	if result, err = inboxConvert(map[string]any{"notebook": box.ID, "path": "/A/B/New", "ids": "1"}); err != nil || !result.IsError ||
		!strings.Contains(result.Content[0].Text, "pathAmbiguous") {
		t.Fatalf("inbox reached cloud conversion before rejecting the legacy path: %+v, %v", result, err)
	}
}
