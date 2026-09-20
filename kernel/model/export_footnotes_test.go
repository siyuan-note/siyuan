package model

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func newFootnoteTestRef(id string) *ast.Node {
	return &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: id,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"}
}

func newFootnoteTestDoc(t *testing.T, boxID, text string) *parse.Tree {
	t.Helper()
	tree := treenode.NewTree(boxID, "/"+ast.NewNodeID()+".sy", "/"+text, text)
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
	return tree
}

func TestExportFootnotesStayWithinBlockScope(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Export, Conf.Editor = conf.NewExport(), conf.NewEditor()
	a := newFootnoteTestDoc(t, fixture.box.ID, "selected paragraph")
	b := newFootnoteTestDoc(t, fixture.box.ID, "unrelated B")
	c := newFootnoteTestDoc(t, fixture.box.ID, "unrelated C")
	b.Root.FirstChild.AppendChild(newFootnoteTestRef(c.Root.FirstChild.ID))
	c.Root.FirstChild.AppendChild(newFootnoteTestRef(b.Root.FirstChild.ID))
	other := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	other.AppendChild(newFootnoteTestRef(b.Root.FirstChild.ID))
	a.Root.AppendChild(other)
	for _, tree := range []*parse.Tree{a, b, c} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	for _, scenario := range []struct {
		name string
		id   string
		want int
	}{
		{"plain block", a.Root.FirstChild.ID, 0},
		{"referencing block", other.ID, 2},
		{"whole document", a.ID, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tree := prepareExportTree(getExportBlockTree(scenario.id))
			exported, err := exportTree(tree, true, true, false, true,
				4, 0, 0, "#", "#", "", "", false, "", false, true, true, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := len(exported.Root.ChildrenByType(ast.NodeFootnotesDef)); got != scenario.want {
				t.Fatalf("expected %d reachable footnotes, got %d", scenario.want, got)
			}
			if exported.ID != a.ID {
				t.Fatal("block export changed document identity")
			}
		})
	}
}

func TestExportBlockAssetsExcludeUnrelatedContent(t *testing.T) {
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	a := newFootnoteTestDoc(t, fixture.box.ID, "selected")
	b := newFootnoteTestDoc(t, fixture.box.ID, "unrelated resource")
	parsed := parse.Parse("", []byte("![image](assets/file.bin)"), util.NewLute().ParseOptions)
	b.Root.FirstChild.AppendChild(parsed.Root.FirstChild.FirstChild)
	other := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	other.AppendChild(newFootnoteTestRef(b.Root.FirstChild.ID))
	a.Root.AppendChild(other)
	for _, tree := range []*parse.Tree{a, b} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	Conf.Export.IncludeRelatedDocs = true
	if err := prepareExportBlockAssets(a.Root.FirstChild.ID, false); err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(util.DataDir, "assets", "file.bin")
	if _, err := os.Stat(assetPath); !os.IsNotExist(err) {
		t.Fatalf("unrelated resource was downloaded: %v", err)
	}
	if err := prepareExportBlockAssets(other.ID, false); err != nil {
		t.Fatal(err)
	}
	if content, err := os.ReadFile(assetPath); err != nil || !strings.Contains(string(content), "version one") {
		t.Fatalf("reachable footnote resource was not downloaded: %q, %v", content, err)
	}
	if err := prepareExportBlockAssets(a.Root.FirstChild.ID, false); err != nil {
		t.Fatalf("export without deferred resources failed: %v", err)
	}
}

func TestExportFootnotesPruneUnreachable(t *testing.T) {
	for _, scenario := range []struct {
		name string
		refs []string
		want []string
	}{
		{"no references", nil, nil},
		{"reachable cycle", []string{"1"}, []string{"1", "2", "3"}},
		{"isolated chain", []string{"6"}, []string{"6"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument}
			for _, id := range scenario.refs {
				root.AppendChild(&ast.Node{Type: ast.NodeFootnotesRef, FootnotesRefId: id})
			}
			defs := &ast.Node{Type: ast.NodeFootnotesDefBlock}
			for _, pair := range [][2]string{{"1", "2"}, {"2", "3"}, {"3", "2"}, {"4", "5"}, {"5", ""}, {"6", ""}} {
				def := &ast.Node{Type: ast.NodeFootnotesDef, FootnotesRefId: pair[0]}
				if pair[1] != "" {
					def.AppendChild(&ast.Node{Type: ast.NodeFootnotesRef, FootnotesRefId: pair[1]})
				}
				defs.AppendChild(def)
			}
			root.AppendChild(defs)
			pruneExportFootnotes(root, defs, nil)
			var got []string
			for _, def := range root.ChildrenByType(ast.NodeFootnotesDef) {
				got = append(got, def.FootnotesRefId)
			}
			if !reflect.DeepEqual(got, scenario.want) {
				t.Fatalf("expected reachable definitions %v, got %v", scenario.want, got)
			}
			if len(got) == 0 && root.ChildByType(ast.NodeFootnotesDefBlock) != nil {
				t.Fatal("empty footnote separator was retained")
			}
		})
	}
}

func TestExportFootnotesHeadingAndContainerScopes(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Export, Conf.Editor = conf.NewExport(), conf.NewEditor()
	source := newFootnoteTestDoc(t, fixture.box.ID, "source")
	target := newFootnoteTestDoc(t, fixture.box.ID, "target")
	heading := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeHeading, HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("heading")})
	child := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	child.AppendChild(newFootnoteTestRef(target.Root.FirstChild.ID))
	nextHeading := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeHeading, HeadingLevel: 1}
	nextHeading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("next")})
	container := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockquote}
	local := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	local.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("local")})
	reference := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	reference.AppendChild(newFootnoteTestRef(local.ID))
	container.AppendChild(local)
	container.AppendChild(reference)
	for _, node := range []*ast.Node{heading, child, nextHeading, container} {
		source.Root.AppendChild(node)
	}
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	for _, scenario := range []struct {
		name string
		id   string
		want int
	}{
		{"heading includes children", heading.ID, 1},
		{"container retains local anchor", container.ID, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tree, err := exportTree(prepareExportTree(getExportBlockTree(scenario.id)), true, true, false, true,
				4, 0, 0, "#", "#", "", "", false, "", false, true, true, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := len(tree.Root.ChildrenByType(ast.NodeFootnotesDef)); got != scenario.want {
				t.Fatalf("expected %d definitions, got %d", scenario.want, got)
			}
			if scenario.id == container.ID {
				ref := treenode.GetNodeInTree(tree, reference.ID).FirstChild
				if ref.TextMarkAHref != "#"+local.ID {
					t.Fatalf("lost internal anchor: %q", ref.TextMarkAHref)
				}
			}
		})
	}
}

func TestExportFootnotesUseMaterializedTableContent(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Export, Conf.Editor = conf.NewExport(), conf.NewEditor()
	source := newFootnoteTestDoc(t, fixture.box.ID, "source")
	target := newFootnoteTestDoc(t, fixture.box.ID, "target")
	parsed := parse.Parse("", []byte("| Header |\n| --- |\n| value |"), util.NewLute().ParseOptions)
	table := parsed.Root.FirstChild
	cell := table.LastChild.FirstChild
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "((" + target.Root.FirstChild.ID + " 'target'))"}
	if err := treenode.RefreshTableCellRichProjection(parsed.Root); err != nil {
		t.Fatal(err)
	}
	source.Root.AppendChild(table)
	for _, tree := range []*parse.Tree{source, target} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	exported, err := exportTree(prepareExportTree(getExportBlockTree(table.ID)), true, true, false, true,
		4, 0, 0, "#", "#", "", "", false, "", false, true, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(exported.Root.ChildrenByType(ast.NodeFootnotesDef)); got != 1 {
		t.Fatalf("expected one footnote from materialized table, got %d", got)
	}
}

func TestExportBlockAssetsRejectLockedNotebook(t *testing.T) {
	fixture := setupFileOperationTest(t)
	markRuntimeEncryptedBox(fixture.box.ID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(fixture.box.ID) })
	if err := prepareExportBlockAssets(fixture.childID, false); err == nil {
		t.Fatal("locked notebook accepted for block resource preparation")
	}
}
