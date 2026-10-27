//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func newHeadingConversionFixture(t *testing.T, boxID string) (*parse.Tree, *ast.Node, []string) {
	t.Helper()
	tree := newHPathTestDoc(t, boxID, "/", "Source", 1)
	parsed := parse.Parse("", []byte("## **Rich** / ![image](assets/title.png) [link](https://example.com/a/b) $x^2$ #tag#\n\nSame body\n\n### Child\n\nChild body\n\n## Outside\n"), util.NewLute().ParseOptions)
	tree.Root.FirstChild.Unlink()
	for child := parsed.Root.FirstChild; child != nil; {
		next := child.Next
		tree.Root.AppendChild(child)
		child = next
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.Type != ast.NodeDocument {
			node.ID = ast.NewNodeID()
			node.SetIALAttr("id", node.ID)
		}
		return ast.WalkContinue
	})
	heading := tree.Root.FirstChild
	heading.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: tree.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Static reference"})
	// 正文即使与标题相同也保留，不能通过文字相等推断并删除“重复标题”。
	title, err := headingDocTitle(heading)
	if err != nil {
		t.Fatal(err)
	}
	body := heading.Next
	for body.FirstChild != nil {
		body.FirstChild.Unlink()
	}
	body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(treenode.DocumentTitleText(title))})
	ids := []string{body.ID, body.Next.ID, body.Next.Next.ID}
	saveDocumentTitleFeatureTree(t, tree)
	return tree, heading, ids
}

func TestHeadingDocumentRichTitleRoundTrip(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testHeadingDocumentRichTitleRoundTrip(t, prepareDocumentTitleFeatureBox(t))
}

func testHeadingDocumentRichTitleRoundTrip(t *testing.T, boxID string) {
	source, heading, bodyIDs := newHeadingConversionFixture(t, boxID)
	expected, err := render.NewDocumentTitle(heading)
	if err != nil {
		t.Fatal(err)
	}
	_, convertedPath, err := Heading2Doc(heading.ID, boxID, "/", "", false)
	if err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	converted, err := filesys.LoadTree(boxID, convertedPath, util.NewLute())
	if err != nil || converted.ID != heading.ID || converted.Root.DocumentTitle == nil ||
		converted.Root.DocumentTitle.Content != expected.Content || converted.Root.Spec != treenode.RichDocumentTitleSpec {
		t.Fatal("heading title source or identity did not survive conversion", err)
	}
	index := 0
	for child := converted.Root.FirstChild; child != nil; child = child.Next {
		if index >= len(bodyIDs) || child.ID != bodyIDs[index] {
			t.Fatal("conversion duplicated or discarded body blocks")
		}
		index++
	}
	if index != len(bodyIDs) {
		t.Fatal("conversion lost body blocks")
	}
	sourceAfter, err := filesys.LoadTree(boxID, source.Path, util.NewLute())
	if err != nil || sourceAfter.Root.FirstChild == nil || sourceAfter.Root.FirstChild.Type != ast.NodeHeading || sourceAfter.Root.FirstChild.Next != nil {
		t.Fatal("conversion moved blocks outside the heading section", err)
	}
	target := newHPathTestDoc(t, boxID, "/", "Target", 1)
	saveDocumentTitleFeatureTree(t, target)
	if _, _, err = Doc2Heading(converted.ID, target.Root.FirstChild.ID, true); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	restored, err := filesys.LoadTree(boxID, target.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	restoredHeading := treenode.GetNodeInTree(restored, heading.ID)
	got, err := render.NewDocumentTitle(restoredHeading)
	if err != nil || got.Content != expected.Content || restoredHeading.Type != ast.NodeHeading {
		t.Fatal("document title inlines did not survive conversion back to heading", err)
	}
	children := treenode.HeadingChildren(restoredHeading)
	if len(children) != len(bodyIDs) {
		t.Fatalf("document conversion changed body count: %d", len(children))
	}
	for index, child := range children {
		if child.ID != bodyIDs[index] {
			t.Fatal("document conversion changed body order or identity")
		}
	}
	if _, err := os.Stat(headingConversionPath(converted)); !os.IsNotExist(err) {
		t.Fatalf("successful conversion left old document source: %v", err)
	}
}

func TestHeadingDocumentConversionFailuresPreserveSources(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testHeadingDocumentConversionFailuresPreserveSources(t, prepareDocumentTitleFeatureBox(t))
}

func testHeadingDocumentConversionFailuresPreserveSources(t *testing.T, boxID string) {
	injected := errors.New("injected conversion failure")
	for _, failure := range []struct {
		at    int
		after bool
	}{{1, false}, {2, false}, {1, true}, {2, true}} {
		source, heading, _ := newHeadingConversionFixture(t, boxID)
		before, _ := os.ReadFile(headingConversionPath(source))
		io := defaultHeadingConversionIO()
		write, calls := io.write, 0
		io.write = func(tree *parse.Tree, expected []byte) ([]byte, error) {
			calls++
			if calls == failure.at && !failure.after {
				return nil, injected
			}
			written, err := write(tree, expected)
			if calls == failure.at && err == nil {
				return written, injected
			}
			return written, err
		}
		if _, _, err := heading2Doc(heading.ID, boxID, "/", "", false, io); !errors.Is(err, injected) {
			t.Fatalf("heading conversion did not propagate failure: %v", err)
		}
		after, _ := os.ReadFile(headingConversionPath(source))
		if !bytes.Equal(before, after) {
			t.Fatal("failed heading conversion changed original source bytes")
		}
		if Conf.Box(boxID).Exist("/" + heading.ID + ".sy") {
			t.Fatal("failed heading conversion left a duplicate destination")
		}
		if indexed := treenode.GetBlockTreeInBox(heading.ID, boxID); indexed == nil || indexed.RootID != source.ID || indexed.Path != source.Path {
			t.Fatal("failed heading conversion changed original block ownership")
		}
		if journals, err := readDocumentSourceJournals(); err != nil || len(journals) != 0 {
			t.Fatalf("heading conversion compensation retained recovery journals: %v, %v", journals, err)
		}
	}
	for _, failure := range []string{"write before", "write after", "remove"} {
		source := newHPathTestDoc(t, boxID, "/", "Title/body", 2)
		target := newHPathTestDoc(t, boxID, "/", "Target", 1)
		saveDocumentTitleFeatureTree(t, source)
		saveDocumentTitleFeatureTree(t, target)
		sourceBefore, _ := os.ReadFile(headingConversionPath(source))
		targetBefore, _ := os.ReadFile(headingConversionPath(target))
		io := defaultHeadingConversionIO()
		if failure == "remove" {
			io.remove = func(*parse.Tree, []byte) error { return injected }
		} else {
			write := io.write
			io.write = func(tree *parse.Tree, expected []byte) ([]byte, error) {
				if failure == "write before" {
					return nil, injected
				}
				written, err := write(tree, expected)
				return written, errors.Join(err, injected)
			}
		}
		if _, _, err := doc2Heading(source.ID, target.Root.FirstChild.ID, true, io); !errors.Is(err, injected) {
			t.Fatalf("document conversion did not propagate failure: %v", err)
		}
		sourceAfter, _ := os.ReadFile(headingConversionPath(source))
		targetAfter, _ := os.ReadFile(headingConversionPath(target))
		if !bytes.Equal(sourceBefore, sourceAfter) || !bytes.Equal(targetBefore, targetAfter) {
			t.Fatal("failed document conversion did not preserve both original source files")
		}
		if journals, err := readDocumentSourceJournals(); err != nil || len(journals) != 0 {
			t.Fatalf("document conversion compensation retained recovery journals: %v, %v", journals, err)
		}
	}
	// 补偿前目标被其他写入更新时保留该更新，不回滚与本次转换无关的内容。
	source := newHPathTestDoc(t, boxID, "/", "Concurrent source", 1)
	target := newHPathTestDoc(t, boxID, "/", "Concurrent target", 1)
	saveDocumentTitleFeatureTree(t, source)
	saveDocumentTitleFeatureTree(t, target)
	io := defaultHeadingConversionIO()
	var concurrent []byte
	io.remove = func(*parse.Tree, []byte) error {
		target.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Concurrent edit")})
		if _, err := filesys.WriteTree(target); err != nil {
			t.Fatal(err)
		}
		concurrent, _ = os.ReadFile(headingConversionPath(target))
		return injected
	}
	if _, _, err := doc2Heading(source.ID, target.Root.FirstChild.ID, true, io); !errors.Is(err, injected) {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(headingConversionPath(target))
	if !bytes.Equal(current, concurrent) {
		t.Fatal("conversion recovery overwrote a concurrent destination edit")
	}
}
