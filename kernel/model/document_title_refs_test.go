package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func testDynamicTitle(t *testing.T, id, text, target string) *ast.Node {
	t.Helper()
	root := &ast.Node{Type: ast.NodeDocument, ID: id}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
	if target != "" {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
			TextMarkBlockRefID: target, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "stale cached label"})
	}
	if err := treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
		t.Fatal(err)
	}
	return root
}

func testDynamicTitleResolver(nodes map[string]*ast.Node) *dynamicRefAnchorResolver {
	resolver := &dynamicRefAnchorResolver{nodes: map[dynamicRefAnchorKey]*dynamicRefAnchorNode{}, keys: map[string]dynamicRefAnchorKey{}}
	resolver.lookup = func(key dynamicRefAnchorKey) (*ast.Node, error) { return nodes[key.id], nil }
	for id := range nodes {
		key := dynamicRefAnchorKey{id: id}
		resolver.keys[id] = key
		resolver.add(key)
	}
	return resolver
}

func TestDocumentTitleDynamicCycles(t *testing.T) {
	const a, b, c = "20261025000001-abcdefg", "20261025000002-abcdefg", "20261025000003-abcdefg"
	nodes := map[string]*ast.Node{
		a: testDynamicTitle(t, a, "A ", b),
		b: testDynamicTitle(t, b, "B ", a),
		c: testDynamicTitle(t, c, "C ", a),
	}
	for round := 0; round < 4; round++ {
		resolver := testDynamicTitleResolver(nodes)
		if err := resolver.resolve(); err != nil {
			t.Fatal(err)
		}
		for id, want := range map[string]string{a: "A B", b: "B A", c: "C A B"} {
			if got := resolver.value(dynamicRefAnchorKey{id: id}); got != want {
				t.Fatalf("round %d node %s: %q != %q", round, id, got, want)
			}
			_, _ = updateRefText(nodes[id], nodes, resolver)
			if got := treenode.ReadDocumentTitle(nodes[id]).Text; got != want {
				t.Fatalf("round %d persisted title %s: %q != %q", round, id, got, want)
			}
		}
	}
	self := testDynamicTitle(t, a, "Self ", a)
	resolver := testDynamicTitleResolver(map[string]*ast.Node{a: self})
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	if got := resolver.value(dynamicRefAnchorKey{id: a}); got != "Self Self" {
		t.Fatalf("self cycle expanded: %q", got)
	}
	empty := testDynamicTitle(t, a, "", a)
	resolver = testDynamicTitleResolver(map[string]*ast.Node{a: empty})
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	if got := resolver.value(dynamicRefAnchorKey{id: a}); got != a {
		t.Fatalf("empty local cycle fallback: %q", got)
	}
}

func TestDocumentTitleDynamicLongChainAndPrivacy(t *testing.T) {
	const count = 24
	nodes := map[string]*ast.Node{}
	ids := make([]string, count)
	for i := range ids {
		ids[i] = fmt.Sprintf("2026102500%04d-abcdefg", i)
	}
	for i, id := range ids {
		target := ""
		if i+1 < count {
			target = ids[i+1]
		}
		nodes[id] = testDynamicTitle(t, id, "x ", target)
	}
	last, _ := treenode.DocumentTitleParagraph(nodes[ids[count-1]])
	last.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "visible", TextMarkInlineMemoContent: "private note"})
	last.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: ids[0], TextMarkBlockRefSubtype: "s", TextMarkTextContent: " static"})
	if err := treenode.SetDocumentTitleParagraph(nodes[ids[count-1]], last); err != nil {
		t.Fatal(err)
	}
	resolver := testDynamicTitleResolver(nodes)
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	want := strings.Repeat("x ", count) + "visible static"
	if got := resolver.value(dynamicRefAnchorKey{id: ids[0]}); got != want {
		t.Fatalf("long dependency chain: %q != %q", got, want)
	}
	if paragraph, _ := treenode.DocumentTitleParagraph(nodes[ids[count-1]]); paragraph.FirstChild.Next.TextMarkInlineMemoContent != "private note" {
		t.Fatal("anchor projection mutated private source")
	}
}

func TestDocumentTitleDynamicOnlyOwnsTitle(t *testing.T) {
	const a, b = "20261025000001-abcdefg", "20261025000002-abcdefg"
	root := testDynamicTitle(t, a, "Title ", b)
	body := &ast.Node{Type: ast.NodeParagraph, ID: "20261025000003-abcdefg"}
	body.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: b, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "body cache"})
	root.AppendChild(body)
	target := testDynamicTitle(t, b, "Target", "")
	nodes := map[string]*ast.Node{a: root, b: target}
	resolver := testDynamicTitleResolver(nodes)
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	if changed, _ := updateRefText(root, nodes, resolver); !changed {
		t.Fatal("title anchor was not updated")
	}
	if body.FirstChild.TextMarkTextContent != "body cache" || root.FirstChild != body || body.Next != nil {
		t.Fatal("title refresh changed body contents or ownership")
	}
	if got := treenode.ReadDocumentTitle(root).Text; got != "Title Target" {
		t.Fatal(got)
	}
}

func TestDocumentTitleDynamicProjectionAndScope(t *testing.T) {
	oldConf := Conf
	Conf = &AppConf{Editor: NewConfSection(conf.NewEditor())}
	t.Cleanup(func() { Conf = oldConf })
	const a, b = "20261025000001-abcdefg", "20261025000002-abcdefg"
	doc := testDynamicTitle(t, a, "ignored ", b)
	doc.SetIALAttr("name", "Named & safe")
	resolver := testDynamicTitleResolver(map[string]*ast.Node{a: doc})
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	if got := resolver.value(dynamicRefAnchorKey{id: a}); got != "Named &amp; safe" || len(resolver.nodes) != 1 {
		t.Fatalf("explicit name must stop traversal: %q", got)
	}
	// The same ID in distinct encrypted domains is never combined into a cycle.
	resolver = &dynamicRefAnchorResolver{nodes: map[dynamicRefAnchorKey]*dynamicRefAnchorNode{}}
	resolver.lookup = func(key dynamicRefAnchorKey) (*ast.Node, error) {
		if key.boxID == "box-a" && key.id == a {
			return testDynamicTitle(t, a, "A ", b), nil
		}
		if key.boxID == "box-b" && key.id == b {
			return testDynamicTitle(t, b, "secret", ""), nil
		}
		return nil, nil
	}
	resolver.add(dynamicRefAnchorKey{"box-a", a})
	resolver.add(dynamicRefAnchorKey{"box-b", b})
	if err := resolver.resolve(); err != nil {
		t.Fatal(err)
	}
	if got := resolver.value(dynamicRefAnchorKey{"box-a", a}); got != "A "+b {
		t.Fatalf("cross-domain lookup leaked target: %q", got)
	}
	// Legacy documents retain their literal plain title and ignore document body.
	plain := &ast.Node{Type: ast.NodeDocument, ID: a}
	plain.SetIALAttr("title", "**literal**")
	plain.AppendChild(&ast.Node{Type: ast.NodeParagraph})
	if resolved, err := resolveDynamicRefAnchorTexts(map[string]*ast.Node{a: plain}, map[string]*parse.Tree{a: {ID: a, Root: plain}}); err != nil || resolved.value(dynamicRefAnchorKey{id: a}) != "**literal**" {
		t.Fatalf("legacy title changed: %v", err)
	}
}
