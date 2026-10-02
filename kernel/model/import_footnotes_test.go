package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkdownFootnotes(t *testing.T) {
	for _, separator := range []string{"\n", "\n\n", "\r\n", "\r\n\r\n"} {
		for _, api := range []bool{false, true} {
			t.Run(fmt.Sprintf("separator=%q/api=%v", separator, api), func(t *testing.T) {
				markdown := "Text[^one] and[^two] and again[^ONE].\n\n[^one]: First **bold**\n\n    Second paragraph\n\n    - Nested item" + separator + "[^two]: Second [link](https://example.com)\n"
				var tree *parse.Tree
				if api {
					engine := util.NewLute()
					tree = engine.BlockDOM2Tree(markdownWithFootnotes2BlockDOM(engine, markdown))
				} else {
					tree, _, _, _ = parseStdMd([]byte(markdown))
					reassignIDUpdated(tree, ast.NewNodeID(), "20260901000000")
				}
				refs := markdownFootnoteRefs(t, tree)
				if len(refs) != 3 || refs[0].TextMarkBlockRefID != refs[2].TextMarkBlockRefID || refs[0].TextMarkBlockRefID == refs[1].TextMarkBlockRefID {
					t.Fatalf("incorrect footnote targets: %+v", refs)
				}
				for i, want := range []string{"First boldSecond paragraphNested item", "Second link"} {
					target := treenode.GetNodeInTree(tree, refs[i].TextMarkBlockRefID)
					if target == nil || target.Type != ast.NodeListItem || strings.ReplaceAll(target.Text(), "\n", "") != want {
						t.Fatalf("lost footnote definition %d: %+v", i, target)
					}
				}
			})
		}
	}
}

func markdownFootnoteRefs(t *testing.T, tree *parse.Tree) (refs []*ast.Node) {
	t.Helper()
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n.Type == ast.NodeFootnotesRef || n.Type == ast.NodeFootnotesDef || n.Type == ast.NodeFootnotesDefBlock {
			t.Errorf("unconverted footnote: %s", n.Type)
		}
		if treenode.IsBlockRef(n) {
			if !n.IsTextMarkType("sup") || n.TextMarkBlockRefSubtype != "s" {
				t.Errorf("expected superscript static reference: %+v", n)
			}
			if n.TextMarkBlockRefID == "" || treenode.GetNodeInTree(tree, n.TextMarkBlockRefID) == nil {
				t.Errorf("missing footnote target: %s", n.TextMarkBlockRefID)
			}
			refs = append(refs, n)
		}
		return ast.WalkContinue
	})
	return
}

func TestMarkdownFootnotesPreserveLiteralAndUnreferencedContent(t *testing.T) {
	markdown := "Text[^note].\n\nUnknown[^missing].\n\n`[^note]` and \\[^note].\n\n```md\n[^code]: code definition\n```\n\n[^note]: First\n[^NOTE]: Duplicate\n[^unused]: Unreferenced\n[^empty]:\n"
	for _, api := range []bool{false, true} {
		engine := util.NewLute()
		tree, _, _, _ := parseStdMd([]byte(markdown))
		if api {
			tree = engine.BlockDOM2Tree(markdownWithFootnotes2BlockDOM(engine, markdown))
		}
		refs := markdownFootnoteRefs(t, tree)
		if len(refs) != 1 {
			t.Fatalf("api=%v: converted literal or undefined reference: %d", api, len(refs))
		}
		target := treenode.GetNodeInTree(tree, refs[0].TextMarkBlockRefID)
		if target.Text() != "First" {
			t.Fatalf("api=%v: duplicate label did not resolve to the first definition: %s", api, target.Text())
		}
		text := tree.Root.Text()
		for _, want := range []string{"[^missing]", "[^note]", "Duplicate", "Unreferenced"} {
			if !strings.Contains(text, want) {
				t.Errorf("api=%v: lost %q in %q", api, want, text)
			}
		}
		code := tree.Root.ChildByType(ast.NodeCodeBlock)
		if code == nil || !strings.Contains(code.ChildByType(ast.NodeCodeBlockCode).TokensStr(), "[^code]: code definition") {
			t.Errorf("api=%v: modified code example", api)
		}
	}
}

func TestMarkdownFootnotesLargeDocument(t *testing.T) {
	var source strings.Builder
	for i := 1; i <= 1459; i++ {
		fmt.Fprintf(&source, "Text[^%d]\n\n", i)
	}
	for i := 1; i <= 1459; i++ {
		fmt.Fprintf(&source, "[^%d]: Definition %d\n", i, i)
	}
	tree, _, _, _ := parseStdMd([]byte(source.String()))
	refs := markdownFootnoteRefs(t, tree)
	if len(refs) != 1459 {
		t.Fatalf("lost references: %d", len(refs))
	}
	seen := map[string]bool{}
	for i, ref := range refs {
		id := ref.TextMarkBlockRefID
		if seen[id] || treenode.GetNodeInTree(tree, id).Text() != fmt.Sprintf("Definition %d", i+1) {
			t.Fatalf("merged or misdirected definition %d", i+1)
		}
		seen[id] = true
	}
}
