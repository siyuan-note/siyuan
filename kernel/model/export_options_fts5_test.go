//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportOptionsReachMarkdownArchiveStages(t *testing.T) {
	const boxID = "20261009000000-box0001"
	setupMarkdownReferencesTest(t, boxID)
	Conf.Export.AddTitle, Conf.Export.MarkdownYFM, Conf.Export.RemoveAssetsID = false, false, false
	baseline := *Conf.Export
	source := newFootnoteTestDoc(t, boxID, "Source")
	child := newFootnoteTestDoc(t, boxID, "Child")
	child.Path, child.HPath = "/"+source.ID+"/"+child.ID+".sy", "/Source/Child"
	related := newFootnoteTestDoc(t, boxID, "Related")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(related.Root.FirstChild.ID))
	const asset = "assets/image-20261009000000-asset01.png"
	source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "asset", TextMarkAHref: asset})
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, asset), []byte("fixture"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, tree := range []*parse.Tree{source, child, related} {
		writeAssetDownloadDocumentTest(t, tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	for _, overridden := range []bool{true, false} {
		options := &ExportOptions{}
		if overridden {
			options = &ExportOptions{AddTitle: new(true), MarkdownYFM: new(true), RemoveAssetsID: new(true),
				IncludeSubDocs: new(true), IncludeRelatedDocs: new(true)}
		}
		_, zipPath := ExportPandocConvertZipWithOptions([]string{source.ID}, "", ".md", options)
		archive := openExportArchive(t, zipPath)
		md := markdownArchiveDocument(t, archive, "Source")
		if strings.HasPrefix(md, "---\n") != overridden || strings.Contains(md, "# Source") != overridden {
			t.Fatalf("title or front matter option was lost (override=%v): %s", overridden, md)
		}
		assetName := asset
		if overridden {
			assetName = "assets/image.png"
		}
		if !strings.Contains(md, assetName) {
			t.Fatalf("asset ID option was lost (override=%v): %s", overridden, md)
		}
		documents := 0
		for _, file := range archive.File {
			if strings.HasSuffix(file.Name, ".md") {
				documents++
			}
		}
		wantDocuments := 1
		if overridden {
			wantDocuments = 3
		}
		if documents != wantDocuments || *Conf.Export != baseline {
			t.Fatalf("document inclusion or global configuration changed: got %d want %d", documents, wantDocuments)
		}
		if err := archive.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
