//go:build fts5

package model

import (
	"archive/zip"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMarkdownReferencesTest(t *testing.T, boxIDs ...string) {
	t.Helper()
	setupExportPublishTest(t)
	Conf.Export.IncludeSubDocs = false
	Conf.Export.IncludeRelatedDocs = false
	for _, boxID := range boxIDs {
		boxConf := conf.NewBoxConf()
		boxConf.Name, boxConf.Closed = boxID, false
		if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
			t.Fatal(err)
		}
		markRuntimeNormalBox(boxID)
		t.Cleanup(func() { forgetRuntimeNormalBox(boxID) })
	}
}

func markdownArchiveDocument(t *testing.T, archive *zip.ReadCloser, title string) string {
	t.Helper()
	for _, file := range archive.File {
		if path.Base(file.Name) == title+".md" {
			return readZipFile(t, file, file.Name)
		}
	}
	t.Fatalf("missing Markdown document %q", title)
	return ""
}

func TestExportMarkdownReferenceScope(t *testing.T) {
	for _, scenario := range []struct {
		name           string
		includeSubDocs bool
		includeRelated bool
		selectTarget   bool
		wantDocs       int
		wantFootnotes  int
	}{
		{"single document", false, false, false, 1, 2},
		{"selected documents", false, false, true, 2, 1},
		{"include children", true, false, false, 2, 1},
		{"include related", false, true, false, 3, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			const boxID = "20261003000000-box0001"
			setupMarkdownReferencesTest(t, boxID)
			source := newFootnoteTestDoc(t, boxID, "Source")
			target := newFootnoteTestDoc(t, boxID, "Target")
			target.Path, target.HPath = "/"+source.ID+"/"+target.ID+".sy", "/Source/Target"
			external := newFootnoteTestDoc(t, boxID, "External")
			source.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
			source.Root.FirstChild.AppendChild(newFootnoteTestRef(external.Root.FirstChild.ID))
			local := treenode.NewParagraph(ast.NewNodeID())
			local.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("local target")})
			source.Root.AppendChild(local)
			source.Root.FirstChild.AppendChild(newFootnoteTestRef(local.ID))
			target.Root.FirstChild.AppendChild(newFootnoteTestRef(external.Root.FirstChild.ID))
			external.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
			external.Root.FirstChild.AppendChild(newFootnoteTestRef(local.ID))
			for _, tree := range []*parse.Tree{source, target, external} {
				writeAssetDownloadDocumentTest(t, tree)
				sql.IndexTreeQueue(tree)
			}
			sql.FlushQueue()
			Conf.Export.IncludeSubDocs, Conf.Export.IncludeRelatedDocs = scenario.includeSubDocs, scenario.includeRelated
			ids := []string{source.ID}
			if scenario.selectTarget {
				ids = append(ids, target.ID)
			}
			_, zipPath := ExportPandocConvertZip(ids, "", ".md")
			archive := openExportArchive(t, zipPath)
			md := markdownArchiveDocument(t, archive, "Source")
			if got := strings.Count(md, "]: "); got != scenario.wantFootnotes {
				t.Fatalf("expected %d footnotes, got %d: %s", scenario.wantFootnotes, got, md)
			}
			if !strings.Contains(md, "](#"+local.ID+")") || !strings.Contains(md, `id="`+local.ID+`"`) {
				t.Fatalf("lost local reference or anchor: %s", md)
			}
			if scenario.wantDocs > 1 {
				if !strings.Contains(md, "Source/Target.md#"+target.Root.FirstChild.ID) {
					t.Fatalf("exported target did not retain its file link: %s", md)
				}
			} else if strings.Contains(md, "Target.md") || strings.Contains(md, "External.md") {
				t.Fatalf("link points to a document outside the archive: %s", md)
			}
			docCount := 0
			for _, file := range archive.File {
				if strings.HasSuffix(file.Name, ".md") {
					docCount++
				}
			}
			if docCount != scenario.wantDocs {
				t.Fatalf("expected %d documents, got %d", scenario.wantDocs, docCount)
			}
		})
	}
}

func TestExportMarkdownFootnoteLinksToEarlierDocument(t *testing.T) {
	const boxID = "20261003000001-box0002"
	setupMarkdownReferencesTest(t, boxID)
	first := newFootnoteTestDoc(t, boxID, "First")
	source := newFootnoteTestDoc(t, boxID, "Source")
	external := newFootnoteTestDoc(t, boxID, "External")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(external.Root.FirstChild.ID))
	external.Root.FirstChild.AppendChild(newFootnoteTestRef(first.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{first, source, external} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	zipPath := exportPandocConvertZip(boxID, "Ordered", []string{first.Path, source.Path}, nil, "", "", ".md")
	archive := openExportArchive(t, zipPath)
	md := markdownArchiveDocument(t, archive, "Source")
	if !strings.Contains(md, "[^1]:") || !strings.Contains(md, "First.md#"+first.Root.FirstChild.ID) || strings.Contains(md, "[^2]") {
		t.Fatalf("footnote did not link to the exported document: %s", md)
	}
	if firstMD := markdownArchiveDocument(t, archive, "First"); !strings.Contains(firstMD, `id="`+first.Root.FirstChild.ID+`"`) {
		t.Fatalf("earlier document is missing the footnote target anchor: %s", firstMD)
	}
}

func TestExportMarkdownFootnoteAssetsAndCrossNotebook(t *testing.T) {
	const sourceBox = "20261003000002-box0003"
	const targetBox = "20261003000003-box0004"
	setupMarkdownReferencesTest(t, sourceBox, targetBox)
	source := newFootnoteTestDoc(t, sourceBox, "Source")
	target := newFootnoteTestDoc(t, targetBox, "Target")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(target.ID))
	asset := parse.Parse("", []byte("![image](assets/footnote.png)"), util.NewLute().ParseOptions)
	target.Root.AppendChild(asset.Root.FirstChild)
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	assetPath := filepath.Join(util.DataDir, "assets", "footnote.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("footnote image"), 0644); err != nil {
		t.Fatal(err)
	}
	_, zipPath := ExportPandocConvertZip([]string{source.ID}, "", ".md")
	archive := openExportArchive(t, zipPath)
	md := markdownArchiveDocument(t, archive, "Source")
	if !strings.Contains(md, "[^1]:") || !strings.Contains(md, "Target") || !strings.Contains(md, "assets/footnote.png") {
		t.Fatalf("cross-notebook footnote lost content: %s", md)
	}
	if got := readArchiveFile(t, archive, "assets/footnote.png"); got != "footnote image" {
		t.Fatalf("unexpected footnote asset: %s", got)
	}
	archive = openExportArchive(t, ExportNotebooksMarkdown([]string{sourceBox, targetBox}))
	md = markdownArchiveDocument(t, archive, "Source")
	if strings.Contains(md, "[^1]") || !strings.Contains(md, "../"+targetBox+"/Target.md") {
		t.Fatalf("included cross-notebook document should use a file link: %s", md)
	}
}

func TestExportMarkdownFootnoteDeferredAsset(t *testing.T) {
	setupExportPublishTest(t)
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	Conf.Search = conf.NewSearch()
	Conf.Export.IncludeSubDocs, Conf.Export.IncludeRelatedDocs = false, false
	source := newFootnoteTestDoc(t, fixture.box.ID, "Source")
	target := newFootnoteTestDoc(t, fixture.box.ID, "Target")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
	asset := parse.Parse("", []byte("![image](assets/file.bin)"), util.NewLute().ParseOptions)
	target.Root.FirstChild.AppendChild(asset.Root.FirstChild.FirstChild)
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "assets", "file.bin")); !os.IsNotExist(err) {
		t.Fatalf("fixture asset must start deferred: %v", err)
	}
	_, zipPath := ExportPandocConvertZip([]string{source.ID}, "", ".md")
	archive := openExportArchive(t, zipPath)
	if got := readArchiveFile(t, archive, "assets/file.bin"); got != "version one" {
		t.Fatalf("deferred footnote asset was not exported: %q", got)
	}
}

func TestExportMarkdownFootnotesRespectCryptoBoundary(t *testing.T) {
	const sourceBox = "20261003000004-box0005"
	const targetBox = "20261003000005-box0006"
	setupMarkdownReferencesTest(t, sourceBox, targetBox)
	source := newFootnoteTestDoc(t, sourceBox, "Source")
	target := newFootnoteTestDoc(t, targetBox, "Private")
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(target.ID))
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	markRuntimeEncryptedBox(targetBox)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(targetBox) })
	refs := &markdownExportReferences{docIDs: map[string]bool{source.ID: true, target.ID: true}, anchorIDs: map[string]bool{}}
	if refs.contains(target.ID, sourceBox) {
		t.Fatal("export membership bypassed the crypto boundary")
	}
	_, zipPath := ExportPandocConvertZip([]string{source.ID}, "", ".md")
	archive := openExportArchive(t, zipPath)
	md := markdownArchiveDocument(t, archive, "Source")
	if strings.Contains(md, "Private") || strings.Contains(md, ".md#") {
		t.Fatalf("export traversed the crypto boundary: %s", md)
	}
	if len(archive.File) != 1 {
		t.Fatalf("export included content beyond the crypto boundary: %v", archive.File)
	}
}

func TestExportMarkdownOtherReferenceModes(t *testing.T) {
	for _, mode := range []int{2, 3} {
		t.Run(strconv.Itoa(mode), func(t *testing.T) {
			const boxID = "20261003000006-box0007"
			setupMarkdownReferencesTest(t, boxID)
			Conf.Export.BlockRefMode = mode
			source := newFootnoteTestDoc(t, boxID, "Source")
			target := newFootnoteTestDoc(t, boxID, "Target")
			source.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
			for _, tree := range []*parse.Tree{source, target} {
				writeAssetDownloadDocumentTest(t, tree)
			}
			_, zipPath := ExportPandocConvertZip([]string{source.ID}, "", ".md")
			md := markdownArchiveDocument(t, openExportArchive(t, zipPath), "Source")
			if strings.Contains(md, "[^") || strings.Contains(md, "Target.md") || !strings.Contains(md, "reference") {
				t.Fatalf("unexpected reference mode %d output: %s", mode, md)
			}
			if strings.Contains(md, "siyuan://blocks/"+target.Root.FirstChild.ID) != (mode == 2) {
				t.Fatalf("reference mode %d lost its link behavior: %s", mode, md)
			}
		})
	}
}
