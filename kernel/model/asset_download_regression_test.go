package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func prepareAssetDownloadDocumentTest(t *testing.T) (*fileOperationTestFixture, *dejavu.Repo, *dejavu.Repo, string) {
	fixture := setupFileOperationTest(t)
	full, partial, fullData := prepareAssetDownloadRepoTest(t)
	Conf.Export, Conf.Editor, Conf.Appearance = conf.NewExport(), conf.NewEditor(), conf.NewAppearance()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	for i := 0; i < 3; i++ {
		writeAssetDownloadDocumentTest(t, treenode.NewTree(fixture.box.ID, "/"+ast.NewNodeID()+".sy", "/Seed", "Seed"))
	}
	if err := fixture.box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	return fixture, full, partial, fullData
}

func writeAssetDownloadDocumentTest(t *testing.T, tree *parse.Tree) {
	t.Helper()
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	t.Cleanup(func() { cache.RemoveTreeData(tree.ID); cache.RemoveDocIAL(tree.Path) })
}

func TestAssetDownloadCrossNotebookExport(t *testing.T) {
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	otherBox := &Box{ID: "20260905210000-abcdefg"}
	if err := otherBox.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	other := treenode.NewTree(otherBox.ID, "/20260905210001-abcdefg.sy", "/Other", "Other")
	writeAssetDownloadDocumentTest(t, other)
	source := treenode.NewTree(fixture.box.ID, "/20260905210002-abcdefg.sy", "/Source", "Source")
	source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: other.Root.FirstChild.ID, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Other"})
	writeAssetDownloadDocumentTest(t, source)
	Conf.Export.IncludeRelatedDocs = true
	_, paths := prepareExportTrees([]string{source.Path}, source.Box)
	if len(paths) != 2 {
		t.Fatalf("expected two export documents, got %v", paths)
	}
	if err := prepareExportAssets(source.Box, paths); err != nil {
		t.Fatalf("cross-notebook export prefetch failed: %v", err)
	}
}

func TestAssetDownloadFootnoteExport(t *testing.T) {
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	target := treenode.NewTree(fixture.box.ID, "/20260905210003-abcdefg.sy", "/Target", "Target")
	parsed := parse.Parse("", []byte("![image](assets/file.bin)"), util.NewLute().ParseOptions)
	target.Root.FirstChild.AppendChild(parsed.Root.FirstChild.FirstChild)
	writeAssetDownloadDocumentTest(t, target)
	source := treenode.NewTree(fixture.box.ID, "/20260905210004-abcdefg.sy", "/Source", "Source")
	source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target.Root.FirstChild.ID, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
	writeAssetDownloadDocumentTest(t, source)
	Conf.Export.IncludeRelatedDocs = false
	Conf.Export.BlockRefMode = 4
	if err := prepareExportBlockAssets(source.ID, false); err != nil {
		t.Fatal(err)
	}
	exported := exportTree(prepareExportTree(getExportBlockTree(source.ID)), true, false, true,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, "", Conf.Export.InlineMemo, true, true)
	containsAsset := false
	for _, dest := range getAssetsLinkDests(exported.Root, false) {
		if dest == "assets/file.bin" {
			containsAsset = true
		}
	}
	if !containsAsset {
		t.Fatal("exported footnotes did not include the resource")
	}
	exportDir := t.TempDir()
	appearancePath := util.AppearancePath
	t.Cleanup(func() { util.AppearancePath = appearancePath })
	util.AppearancePath = t.TempDir()
	if err := os.MkdirAll(filepath.Join(util.AppearancePath, "themes", Conf.Appearance.ThemeLight), 0755); err != nil {
		t.Fatal(err)
	}
	_, _, exportErr := exportMarkdownHTML(source.ID, exportDir, false, false)
	if exportErr != nil {
		t.Fatalf("HTML export failed: %v", exportErr)
	}
	if _, err := os.Stat(filepath.Join(exportDir, "assets", "file.bin")); err != nil {
		t.Fatalf("HTML export did not copy the footnote resource: %v", err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "assets", "file.bin")); err != nil {
		t.Fatalf("footnote resource was not prefetched: %v", err)
	}
}
