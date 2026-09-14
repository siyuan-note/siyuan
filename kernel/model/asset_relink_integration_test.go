//go:build fts5

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetRelinkPersistenceAndHistory(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_RELINK"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestAssetRelinkPersistenceAndHistory$", "-test.timeout=45s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	setupAttributeViewRefI18n(t)
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	util.ConfDir = t.TempDir()
	util.HistoryDir, util.TempDir = t.TempDir(), t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitAssetContentDatabase(true)
	sql.InitHistoryDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	orphan, orphanBefore := assetRelinkUnavailableTree(t)
	writeAssetRelinkTestFile(t, "assets/a.png", []byte("original asset"))
	writeAssetRelinkTestFile(t, "assets/b.webp", []byte("replacement asset"))
	writeAssetRelinkTestFile(t, "assets/ocr-texts.json", []byte(`{"assets/a.png":"OCR text"}`))
	const viewID = "20260914020000-relink0"
	view := av.NewAttributeView(viewID)
	view.KeyValues = append(view.KeyValues, &av.KeyValues{
		Key:    &av.Key{ID: "20260914020001-relink1", Type: av.KeyTypeMAsset, Name: "Assets"},
		Values: []*av.Value{{ID: "20260914020002-relink2", Type: av.KeyTypeMAsset, MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Content: "assets/a.png#x"}}}},
	})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(fixture.box.ID, "/20260914020003-relink3.sy", "/Document", "Document")
	p := treenode.NewParagraph("20260914020004-relink4")
	p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/a.png?page=2#x", TextMarkTextContent: "assets/a.png"})
	tree.Root.AppendChild(p)
	tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: "20260914020005-relink5", AttributeViewID: viewID})
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sources := []string{fixture.box.ID + tree.Path, "storage/av/" + viewID + ".json"}
	before := map[string][]byte{}
	for _, source := range sources {
		before[source], _ = os.ReadFile(filepath.Join(util.DataDir, source))
	}
	preview, err := RelinkAsset("assets/a.png", "assets/b.webp", true)
	if err != nil || len(preview.References) != 3 {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	result, err := RelinkAsset("assets/a.png", "assets/b.webp", false)
	if err != nil || result.Updated != 3 || result.HistoryPath == "" || len(result.References) != len(preview.References) {
		t.Fatalf("apply: %+v %v", result, err)
	}
	checkAssetRelinkUnavailable(t, result, orphan)
	orphanAfter, _ := os.ReadFile(filepath.Join(util.DataDir, orphan.Box, orphan.Path))
	if !bytes.Equal(orphanBefore, orphanAfter) {
		t.Fatal("unrelated orphan document changed during relink")
	}
	for _, source := range sources {
		history, readErr := os.ReadFile(filepath.Join(result.HistoryPath, source))
		if readErr != nil || !bytes.Equal(history, before[source]) {
			t.Fatalf("source history differs: %s %v", source, readErr)
		}
	}
	loaded, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		t.Fatalf("document relink failed: %v", err)
	}
	found := false
	ast.Walk(loaded.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsTextMarkType("a") {
			found = n.TextMarkAHref == "assets/b.webp?page=2#x" && n.TextMarkTextContent == "assets/a.png"
		}
		return ast.WalkContinue
	})
	if !found {
		t.Fatal("document link or label differs")
	}
	view, err = av.ParseAttributeView(viewID)
	if err != nil || view.KeyValues[len(view.KeyValues)-1].Values[0].MAsset[0].Content != "assets/b.webp#x" {
		t.Fatalf("database relink failed: %+v %v", view, err)
	}
	if util.GetAssetText("assets/a.png") != "OCR text" || util.GetAssetText("assets/b.webp") != "OCR text" {
		t.Fatal("OCR metadata not preserved")
	}
	if data, _ := os.ReadFile(filepath.Join(util.DataDir, "assets/a.png")); string(data) != "original asset" {
		t.Fatal("source asset changed")
	}
	// 反向改写使用独立历史目录，同一秒的调用不得覆盖前一次恢复数据。
	reverse, err := RelinkAsset("assets/b.webp", "assets/a.png", false)
	if err != nil || reverse.HistoryPath == result.HistoryPath {
		t.Fatalf("reverse relink: %+v %v", reverse, err)
	}
	for _, source := range sources {
		history, _ := os.ReadFile(filepath.Join(result.HistoryPath, source))
		if !bytes.Equal(history, before[source]) {
			t.Fatal("previous history was overwritten")
		}
	}
	writeAssetRelinkTestFile(t, "assets/a.pdf", []byte("original pdf"))
	writeAssetRelinkTestFile(t, "assets/b.pdf", []byte("replacement pdf"))
	writeAssetRelinkTestFile(t, "assets/a.pdf.sya", []byte(`{"20260914020006-relink6":{"text":"annotation"}}`))
	pdfResult, err := RelinkAsset("assets/a.pdf", "assets/b.pdf", false)
	if err != nil || pdfResult.Updated != 1 {
		t.Fatalf("annotation metadata: %+v %v", pdfResult, err)
	}
	if data, _ := os.ReadFile(filepath.Join(util.DataDir, "assets/b.pdf.sya")); !strings.Contains(string(data), "annotation") {
		t.Fatal("annotation metadata was not copied")
	}
	// 两组有效映射共享文档、数据库和 OCR，失败项保留原引用。
	writeAssetRelinkTestFile(t, "assets/c.png", []byte("second source"))
	writeAssetRelinkTestFile(t, "assets/d.webp", []byte("second target"))
	util.SetAssetText("assets/c.png", "second OCR")
	loaded, err = filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	paragraph := treenode.NewParagraph("20260914020007-relink7")
	for _, path := range []string{"assets/c.png", "assets/blocked.png"} {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: path, TextMarkTextContent: "link"})
	}
	loaded.Root.AppendChild(paragraph)
	if _, err = filesys.WriteTree(loaded); err != nil {
		t.Fatal(err)
	}
	view, err = av.ParseAttributeView(viewID)
	if err != nil {
		t.Fatal(err)
	}
	value := view.KeyValues[len(view.KeyValues)-1].Values[0]
	value.MAsset = append(value.MAsset, &av.ValueAsset{Type: av.AssetTypeImage, Content: "assets/c.png"})
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, source := range sources {
		before[source], _ = os.ReadFile(filepath.Join(util.DataDir, source))
	}
	mappings := []apicontract.AssetRelinkMapping{
		{OldPath: "assets/a.png", NewPath: "assets/b.webp"},
		{OldPath: "assets/c.png", NewPath: "assets/d.webp"},
		{OldPath: "assets/blocked.png", NewPath: "assets/missing.webp"},
	}
	plan, err := newAssetRelinkPlan(context.Background(), mappings, false, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = plan.run(); err != nil {
		t.Fatal(err)
	}
	batch, err := plan.response(nil)
	if err != nil || batch.Updated != 3 || len(batch.Items) != 3 || !batch.Items[0].OK || !batch.Items[1].OK || batch.Items[2].OK || batch.Items[2].Updated != 0 {
		t.Fatalf("batch apply: %+v %v", batch, err)
	}
	checkAssetRelinkUnavailable(t, batch, orphan)
	if plan.parsedDocuments != 2 || plan.parsedViews != 1 || batch.Items[0].Updated != 2 || batch.Items[1].Updated != 3 {
		t.Fatalf("shared work was duplicated: documents=%d views=%d items=%+v", plan.parsedDocuments, plan.parsedViews, batch.Items)
	}
	for _, source := range sources {
		history, readErr := os.ReadFile(filepath.Join(batch.HistoryPath, source))
		if readErr != nil || !bytes.Equal(history, before[source]) {
			t.Fatalf("batch history contains intermediate state: %s %v", source, readErr)
		}
		data, _ := os.ReadFile(filepath.Join(util.DataDir, source))
		if !bytes.Contains(data, []byte("assets/b.webp")) || !bytes.Contains(data, []byte("assets/d.webp")) {
			t.Fatalf("missing batch replacement: %s", source)
		}
	}
	document, _ := os.ReadFile(filepath.Join(util.DataDir, sources[0]))
	if !bytes.Contains(document, []byte("assets/blocked.png")) || util.GetAssetText("assets/d.webp") != "second OCR" {
		t.Fatal("failed mapping or OCR was not preserved")
	}
	retry, err := RelinkAssets(context.Background(), mappings, false)
	if err != nil || retry.Updated != 0 || retry.HistoryPath != "" {
		t.Fatalf("no-op retry created history: %+v %v", retry, err)
	}
	// 共享文件写入冲突归属全部相关映射，独立文件仍可完成。
	writeAssetRelinkTestFile(t, "assets/e.png", []byte("independent source"))
	writeAssetRelinkTestFile(t, "assets/f.webp", []byte("independent target"))
	independent := treenode.NewTree(tree.Box, "/20260914020008-relink8.sy", "/Independent", "Independent")
	paragraph = treenode.NewParagraph("20260914020009-relink9")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/e.png", TextMarkTextContent: "link"})
	independent.Root.AppendChild(paragraph)
	if _, err = filesys.WriteTree(independent); err != nil {
		t.Fatal(err)
	}
	conflicted, _ := newAssetRelinkPlan(context.Background(), []apicontract.AssetRelinkMapping{
		{OldPath: "assets/b.webp", NewPath: "assets/a.png"},
		{OldPath: "assets/d.webp", NewPath: "assets/c.png"},
		{OldPath: "assets/e.png", NewPath: "assets/f.webp"},
	}, false, false, true)
	sharedPath := filepath.Join(util.DataDir, sources[0])
	conflicted.progress = func(path string) {
		if conflicted.saving && path == sharedPath {
			if err := os.WriteFile(path, append(append([]byte{}, document...), '\n'), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err = conflicted.run(); err != nil {
		t.Fatal(err)
	}
	partial, err := conflicted.response(nil)
	if err != nil || partial.Items[0].OK || partial.Items[1].OK || !partial.Items[2].OK || partial.Updated != 1 {
		t.Fatalf("shared write failure attribution: %+v %v", partial, err)
	}
	current, _ := os.ReadFile(sharedPath)
	if !bytes.Equal(current, append(append([]byte{}, document...), '\n')) {
		t.Fatal("concurrent document edit was overwritten")
	}
}
