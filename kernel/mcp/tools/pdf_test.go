// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package tools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPDFToolWorkflow(t *testing.T) {
	const env = "SIYUAN_TEST_PDF_TOOL"
	if os.Getenv(env) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPDFToolWorkflow$", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), env+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("PDF tool subprocess: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir = filepath.Join(root, "data"), filepath.Join(root, "temp")
	util.ConfDir, util.HistoryDir = filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "assets.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir, filepath.Join(util.DataDir, "assets")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "pdf-tools-test"
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
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Export.Store(conf.NewExport())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	defer treenode.CloseDatabase()
	box := &model.Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "PDF tools"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(box.ID, "/"+ast.NewNodeID()+".sy", "/PDF tools", "PDF tools")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/figures.pdf", TextMarkTextContent: "PDF"})
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if err := os.WriteFile(filepath.Join(util.DataDir, "assets", "figures.pdf"), testutil.PDFImageFixture(""), 0644); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"action": "list", "documentID": tree.ID, "path": "assets/figures.pdf"}
	result, err := pdfHandler(context.Background(), args)
	if err != nil || result.IsError {
		t.Fatalf("list: %+v %v", result, err)
	}
	var list model.PDFImageList
	if err = json.Unmarshal([]byte(result.Content[0].Text), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Images) != 3 {
		t.Fatalf("inventory: %+v", list)
	}
	args["action"], args["revision"], args["page"], args["object"] = "preview", list.Revision, 1, list.Images[0].Object
	preview, err := pdfHandler(context.Background(), args)
	if err != nil || preview.IsError || len(preview.ModelAttachments) != 1 || len(preview.ModelAttachments[0].Data) == 0 || preview.ModelAttachments[0].PDFImage.Revision != list.Revision {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	args["action"], args["id"], args["images"] = "extract", tree.ID, []any{map[string]any{"page": 1, "object": list.Images[0].Object}, map[string]any{"page": 3, "object": 999}}
	result, err = pdfHandler(context.Background(), args)
	if err != nil || result.IsError {
		t.Fatalf("extract: %+v %v", result, err)
	}
	var extracted struct {
		Images []model.PDFImageExtractResult `json:"images"`
	}
	if err = json.Unmarshal([]byte(result.Content[0].Text), &extracted); err != nil {
		t.Fatal(err)
	}
	if len(extracted.Images) != 2 || extracted.Images[0].Artifact == nil || extracted.Images[1].Error == "" {
		t.Fatalf("partial extraction: %+v", extracted)
	}
	item := extracted.Images[0]
	markdown := "![Figure](" + item.Artifact.Path + ")\n\n[Source PDF, page 1](" + item.SourceURL + ")"
	appended, err := blockHandler(map[string]any{"action": "append", "parentID": tree.ID, "dataType": "markdown", "data": markdown})
	if err != nil || appended.IsError {
		t.Fatalf("insert extracted image: %+v %v", appended, err)
	}
	assets, err := model.DocAssets(tree.ID, true)
	if err != nil || !strings.Contains(strings.Join(assets, "\n"), item.Artifact.Path) {
		t.Fatalf("image missing from note: %v %v", assets, err)
	}
	args["action"], args["page"] = "preview", 1.5
	invalid, _ := pdfHandler(context.Background(), args)
	if !invalid.IsError {
		t.Fatal("fractional page accepted")
	}
}

func TestPDFToolPermissionsAndSchema(t *testing.T) {
	tool := GetTool("pdf")
	if tool == nil || tool.BoxLeaseResolver == nil {
		t.Fatal("PDF tool or notebook lease resolver missing")
	}
	for _, action := range []string{"list", "preview", "extract"} {
		effects, declared := tool.EffectsFor(action)
		if !declared || !effects.LocalRead || effects.LocalWrite != (action == "extract") || effects.DataEgress != (action == "preview") || effects.ExternalCost != (action == "preview") {
			t.Fatalf("%s effects: %+v", action, effects)
		}
	}
	validator, err := CompileToolValidator(tool)
	if err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateInputContext(context.Background(), map[string]any{"action": "list", "documentID": "doc", "path": "assets/a.pdf", "pages": []any{1.5}}); err == nil {
		t.Fatal("schema accepted fractional page")
	}
}
