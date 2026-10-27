//go:build fts5

package model

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentTitleFeatureTestProcess(t *testing.T) bool {
	t.Helper()
	const helper = "SIYUAN_TEST_DOCUMENT_TITLE_FEATURE"
	if os.Getenv(helper) == t.Name() {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
	command.Env = append(os.Environ(), helper+"="+t.Name())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("document title subprocess: %v\n%s", err, output)
	}
	return false
}

func prepareDocumentTitleFeatureBox(t *testing.T) string {
	t.Helper()
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Title/Features", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	return box.ID
}

func saveDocumentTitleFeatureTree(t *testing.T, tree *parse.Tree) {
	t.Helper()
	if err := indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
}

func TestDocumentTitleBacklinkSources(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testDocumentTitleBacklinkSources(t, prepareDocumentTitleFeatureBox(t))
}

func testDocumentTitleBacklinkSources(t *testing.T, boxID string) {
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	reference := newHPathTestDoc(t, boxID, "/", "Reference", 1)
	title := &ast.Node{Type: ast.NodeParagraph}
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref strong", TextMarkBlockRefID: definition.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Alpha"})
	title.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" / ")})
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Definition"})
	if err := treenode.SetDocumentTitleParagraph(reference.Root, title); err != nil {
		t.Fatal(err)
	}
	body := reference.Root.FirstChild
	for body.FirstChild != nil {
		body.FirstChild.Unlink()
	}
	body.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Zulu"})
	reference.Root.AppendChild(treenode.NewParagraph("BODY_MUST_NOT_APPEAR_IN_TITLE_PREVIEW"))
	saveDocumentTitleFeatureTree(t, definition)
	saveDocumentTitleFeatureTree(t, reference)
	assertSources := func(want int) {
		t.Helper()
		refs := sql.QueryRefsByDefIDInBox(definition.ID, false, boxID)
		if len(refs) != want {
			t.Fatalf("title/body reference count = %d, want %d: %+v", len(refs), want, refs)
		}
		seen := map[string]bool{}
		for _, ref := range refs {
			if ref.RootID != reference.ID || (ref.BlockID != reference.ID && ref.BlockID != body.ID) || seen[ref.BlockID] {
				t.Fatalf("incorrect title reference identity: %+v", ref)
			}
			seen[ref.BlockID] = true
		}
	}
	assertSources(2)
	assertPreview := func(backlinks []*Backlink) {
		t.Helper()
		var titlePreview *Backlink
		for _, backlink := range backlinks {
			if backlink.ID == reference.ID {
				titlePreview = backlink
			}
		}
		if len(backlinks) != 2 || titlePreview == nil {
			t.Fatalf("title and body must remain separate backlink sources: %+v", backlinks)
		}
		if titlePreview.Type != ast.NodeDocument.String() || !strings.Contains(titlePreview.DOM, `data-document-title="true"`) ||
			!strings.Contains(titlePreview.DOM, `data-node-id="`+reference.ID+`"`) || !strings.Contains(titlePreview.DOM, "Alpha") ||
			strings.Contains(titlePreview.DOM, "BODY_MUST_NOT_APPEAR") || strings.Contains(titlePreview.DOM, `contenteditable="true"`) {
			t.Fatalf("incorrect document title preview: %s", titlePreview.DOM)
		}
	}
	for _, sortMode := range []int{0, 1, 2} {
		backlinks, _ := GetBacklinkDocInBoxWithSort(definition.ID, reference.ID, "", false, false, boxID, sortMode)
		assertPreview(backlinks)
	}
	_, paths, _, count, _ := GetBacklink2InBoxWithOptions(definition.ID, "", "", 0, 0, false, boxID, nil, false, true)
	if len(paths) != 1 || paths[0].Count != 2 || count != 2 {
		t.Fatalf("document backlink counts lost source identity: %+v, %d", paths, count)
	}
	query := GlobalBacklinkQuery{ID: definition.ID, Notebook: boxID, Sort: 1}
	accessible := func(string) bool { return true }
	token, items, total, _, expired, err := GetGlobalBacklinks(query, "", 0, "", accessible)
	if err != nil || expired || total != 2 || len(items) != 2 || items[0].ID != reference.ID || items[0].Anchor != "Alpha" {
		t.Fatalf("global title anchor/sort: %+v, %d, %v, %v", items, total, expired, err)
	}
	contexts, expired, err := GetGlobalBacklinkContexts(query, token, []string{reference.ID, body.ID}, accessible)
	if err != nil || expired {
		t.Fatal(err, expired)
	}
	assertPreview(contexts)
	loaded, err := filesys.LoadTree(boxID, reference.Path, util.NewLute())
	if err != nil || loaded.Root.FirstChild.ID != body.ID || loaded.Root.FirstChild.Next == nil || loaded.Root.FirstChild.Next.Next != nil {
		t.Fatal("backlink rendering changed document source or inserted a title block", err)
	}
	plain := &ast.Node{Type: ast.NodeParagraph}
	plain.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Plain")})
	if err := treenode.SetDocumentTitleParagraph(reference.Root, plain); err != nil {
		t.Fatal(err)
	}
	saveDocumentTitleFeatureTree(t, reference)
	assertSources(1)
	if err := treenode.SetDocumentTitleParagraph(reference.Root, title); err != nil {
		t.Fatal(err)
	}
	saveDocumentTitleFeatureTree(t, reference)
	assertSources(2)
}
