package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMarkdownSpoolTest(t *testing.T) {
	t.Helper()
	originalConf, originalTemp := Conf, util.TempDir
	Conf = NewAppConf()
	Conf.Editor, Conf.Export = conf.NewEditor(), conf.NewExport()
	util.TempDir = t.TempDir()
	t.Cleanup(func() { Conf, util.TempDir = originalConf, originalTemp })
}

func markdownSpoolFixture(markdown, title string, document int) *parse.Tree {
	tree, _, _, _ := parseStdMd([]byte(markdown), true)
	tree.Root.ID = tree.Root.IALAttr("id")
	ids := map[string]string{}
	count := 0
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.ID != "" {
			id := fmt.Sprintf("20261010000000-%07d", document*1000+count)
			count++
			ids[n.ID] = id
			n.ID = id
			n.SetIALAttr("id", id)
			n.SetIALAttr("updated", "20261010000000")
		}
		return ast.WalkContinue
	})
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && treenode.IsBlockRef(n) {
			if id := ids[n.TextMarkBlockRefID]; id != "" {
				n.TextMarkBlockRefID = id
			}
		}
		return ast.WalkContinue
	})
	tree.ID, tree.Box = tree.Root.ID, "20261010000000-box0001"
	tree.Path, tree.HPath = "/"+tree.ID+".sy", "/"+title
	tree.Root.Spec = treenode.CurrentSpec
	tree.Root.SetIALAttr("title", title)
	return tree
}

func renderMarkdownSpoolFixture(tree *parse.Tree) []byte {
	engine := util.NewLute()
	return render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
}

func TestMarkdownImportSpoolPreservesConversion(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	fixtures := []struct{ title, markdown string }{
		{"one", "# Heading one\n\n[[two#Heading two|forward]] and [document](two.md).\n\n*em* **strong** `code` $x+y$ #tag\n\nText[^note].\n\n[^note]: Footnote **content**\n\n| a | b |\n| -- | -- |\n| 1 | 2 |\n\n```go\nfmt.Println(1)\n```\n\n<div>HTML <b>bold</b></div>\n"},
		{"two", "# Heading two\n\n[[one#Heading one]] and [[missing]].\n\n> Quote\n\n- [x] Task\n- Item\n\n![image](assets/image.png)\n"},
	}
	links := map[string]string{}
	var original []*parse.Tree
	for i, fixture := range fixtures {
		tree := markdownSpoolFixture(fixture.markdown, fixture.title, i+1)
		original = append(original, tree)
		addImportSearchLinks(tree, links)
		if err := spool.add(markdownSpoolFixture(fixture.markdown, fixture.title, i+1)); err != nil {
			t.Fatal(err)
		}
	}
	engine := NewLute()
	engine.SetHTMLTag2TextMark(true)
	var expected [][]byte
	for _, tree := range original {
		convertMdHyperlinks2WikiLinks(tree)
		convertWikiLinksAndTags(tree, links)
		mergeTextAndHandlerNestedInlines(tree, engine)
		expected = append(expected, renderMarkdownSpoolFixture(tree))
	}
	i := 0
	if err := spool.finish(func(tree *parse.Tree) error {
		if got := renderMarkdownSpoolFixture(tree); !bytes.Equal(got, expected[i]) {
			t.Errorf("staging changed document %d\ngot: %s\nwant: %s", i, got, expected[i])
		}
		i++
		return nil
	}, func() {}); err != nil {
		t.Fatal(err)
	}
	if i != len(fixtures) {
		t.Fatal("conversion omitted a document")
	}
}

func TestMarkdownImportSpoolBoundsQueuedTrees(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	for i := range 2*markdownImportBatchDocuments + 1 {
		if err := spool.add(markdownSpoolFixture("# Heading\n\ncontent", fmt.Sprint(i), i)); err != nil {
			t.Fatal(err)
		}
	}
	var queued []*parse.Tree
	flushed := 0
	if err := spool.finish(func(tree *parse.Tree) error {
		queued = append(queued, tree)
		if len(queued) > markdownImportBatchDocuments {
			t.Fatal("queue retained more than one batch of trees")
		}
		return nil
	}, func() {
		flushed += len(queued)
		queued = nil
	}); err != nil {
		t.Fatal(err)
	}
	if flushed != len(spool.entries) || len(queued) != 0 {
		t.Fatal("final indexing batch was not drained")
	}
}

func TestMarkdownImportSpoolAuthenticatesAndCleansUp(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	const secret = "private Markdown content must not be staged in plaintext"
	if err := spool.add(markdownSpoolFixture(secret, "private", 1)); err != nil {
		t.Fatal(err)
	}
	fileName := spool.file.Name()
	ciphertext, err := os.ReadFile(fileName)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ciphertext, []byte(secret)) {
		t.Fatal("staging file exposed plaintext")
	}
	if _, err := util.DecryptWithAAD(make([]byte, 32), ciphertext, markdownImportAAD(0)); err == nil {
		t.Fatal("wrong key authenticated staged data")
	}
	if _, err := util.DecryptWithAAD(spool.key, ciphertext, markdownImportAAD(1)); err == nil {
		t.Fatal("staged data was not bound to its entry")
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if _, err := spool.file.WriteAt(ciphertext, 0); err != nil {
		t.Fatal(err)
	}
	if err := spool.finish(func(*parse.Tree) error {
		t.Fatal("unauthenticated staged data reached the writer")
		return nil
	}, func() {}); err == nil {
		t.Fatal("corrupted staging entry was accepted")
	}
	if got, err := os.ReadFile(fileName); err != nil || !bytes.Equal(got, ciphertext) {
		t.Fatal("authentication failure rewrote staged ciphertext")
	}
	key := spool.key
	spool.close()
	if _, err := os.Stat(fileName); !os.IsNotExist(err) {
		t.Fatal("temporary staging file was not removed")
	}
	if !bytes.Equal(key, make([]byte, len(key))) {
		t.Fatal("staging key was not cleared")
	}
}

func TestMarkdownImportSpoolFlushesOnWriteFailure(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	for i := range 3 {
		if err := spool.add(markdownSpoolFixture("content", fmt.Sprint(i), i)); err != nil {
			t.Fatal(err)
		}
	}
	writes, flushes := 0, 0
	failure := errors.New("disk write failed")
	err = spool.finish(func(*parse.Tree) error {
		writes++
		if writes == 2 {
			return failure
		}
		return nil
	}, func() { flushes++ })
	if !errors.Is(err, failure) || writes != 2 || flushes != 1 {
		t.Fatalf("write error or pending batch lost: %v, writes=%d, flushes=%d", err, writes, flushes)
	}
}

func TestMarkdownImportSpoolFlushesByBytes(t *testing.T) {
	setupMarkdownSpoolTest(t)
	spool, err := newMarkdownImportSpool()
	if err != nil {
		t.Fatal(err)
	}
	defer spool.close()
	if err := spool.add(markdownSpoolFixture(strings.Repeat("x", markdownImportBatchBytes), "large", 1)); err != nil {
		t.Fatal(err)
	}
	if err := spool.add(markdownSpoolFixture("small", "small", 2)); err != nil {
		t.Fatal(err)
	}
	writes, firstFlush := 0, 0
	if err := spool.finish(func(*parse.Tree) error {
		writes++
		return nil
	}, func() {
		if firstFlush == 0 {
			firstFlush = writes
		}
	}); err != nil {
		t.Fatal(err)
	}
	if firstFlush != 1 {
		t.Fatal("large document did not drain the queue by its byte budget")
	}
}
