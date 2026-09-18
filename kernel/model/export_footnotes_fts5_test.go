//go:build fts5

package model

import (
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportFootnotesAfterEmbedExpansion(t *testing.T) {
	setupExportPublishTest(t)
	const boxID = "20260918000000-box0001"
	source := newFootnoteTestDoc(t, boxID, "source")
	embedded := newFootnoteTestDoc(t, boxID, "embedded")
	target := newFootnoteTestDoc(t, boxID, "footnote target")
	embedded.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
	embed := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockQueryEmbed}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript,
		Tokens: []byte("SELECT * FROM blocks WHERE id = '" + embedded.Root.FirstChild.ID + "'")})
	source.Root.AppendChild(embed)
	for _, tree := range []*parse.Tree{source, embedded, target} {
		writeAssetDownloadDocumentTest(t, tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	_, content, _ := ExportHTMLWithTitle(embed.ID, "", true, false, false, false, "")
	if !strings.Contains(content, "footnote target") || strings.Contains(content, "SELECT * FROM") {
		t.Fatalf("image/PDF preview lost embedded footnote: %s", content)
	}
}

func TestExportFootnotesAfterMerge(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Export, Conf.Editor, Conf.Appearance = conf.NewExport(), conf.NewEditor(), conf.NewAppearance()
	Conf.Search = conf.NewSearch()
	oldAppearance := util.AppearancePath
	util.AppearancePath = t.TempDir()
	t.Cleanup(func() { util.AppearancePath = oldAppearance })
	writeAppearanceTestEmojiFont(t)
	for _, dir := range []string{"themes/daylight", "themes/midnight", "icons/litheness"} {
		if err := os.MkdirAll(filepath.Join(util.AppearancePath, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	boxID := fixture.box.ID
	source := newFootnoteTestDoc(t, boxID, "source")
	child := newFootnoteTestDoc(t, boxID, "child")
	child.Path = path.Join("/"+source.ID, child.ID+".sy")
	child.HPath = "/source/child"
	target := newFootnoteTestDoc(t, boxID, "merged footnote target")
	child.Root.FirstChild.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{source, child, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	for _, docx := range []bool{false, true} {
		_, content, err := exportMarkdownHTML(source.ID, t.TempDir(), docx, true)
		if err != nil || !strings.Contains(content, "merged footnote target") {
			t.Fatalf("merged HTML/Word export lost footnote: %v, %s", err, content)
		}
	}
}

func TestExportFootnotesPruneAfterAbbreviation(t *testing.T) {
	setupExportPublishTest(t)
	const boxID = "20260918000002-box0003"
	source := newFootnoteTestDoc(t, boxID, "source")
	target := newFootnoteTestDoc(t, boxID, "unreachable target")
	local := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	local.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(strings.Repeat("long text ", 12))})
	local.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
	source.Root.AppendChild(local)
	source.Root.FirstChild.AppendChild(newFootnoteTestRef(local.ID))
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	_, content, _ := ExportHTMLWithTitle(source.Root.FirstChild.ID, "", true, false, false, false, "")
	if !strings.Contains(content, "long text") || strings.Contains(content, "unreachable target") {
		t.Fatalf("abbreviated footnote retained an unreachable dependency: %s", content)
	}
}

func TestExportBlockAssetsEmbeddedScopes(t *testing.T) {
	setupExportPublishTest(t)
	prepareAssetDownloadRepoTest(t)
	Conf.Export, Conf.Editor = conf.NewExport(), conf.NewEditor()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	const boxID = "20260918000003-box0004"
	source := newFootnoteTestDoc(t, boxID, "source")
	target := newFootnoteTestDoc(t, boxID, "clean target")
	parsed := parse.Parse("", []byte("![image](assets/file.bin)"), util.NewLute().ParseOptions)
	resource := parsed.Root.FirstChild
	target.Root.AppendChild(resource)
	var embeds []*ast.Node
	for _, ids := range []string{
		"'" + target.Root.FirstChild.ID + "'",
		"'" + target.Root.FirstChild.ID + "', '" + resource.ID + "'",
	} {
		embed := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockQueryEmbed}
		embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript,
			Tokens: []byte("SELECT * FROM blocks WHERE id IN (" + ids + ")")})
		source.Root.AppendChild(embed)
		embeds = append(embeds, embed)
	}
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	if err := prepareExportBlockAssets(embeds[0].ID, false); err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(util.DataDir, "assets", "file.bin")
	if _, err := os.Stat(assetPath); !os.IsNotExist(err) {
		t.Fatalf("embedding a paragraph downloaded its sibling's resource: %v", err)
	}
	if err := prepareExportBlockAssets(embeds[1].ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(assetPath); err != nil {
		t.Fatalf("multiple embedded blocks in one document lost a resource: %v", err)
	}
}
