//go:build fts5

package model

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
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
}
