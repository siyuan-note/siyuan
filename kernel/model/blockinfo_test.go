// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWalkBlockBreadcrumbChildren(t *testing.T) {
	doc := &ast.Node{Type: ast.NodeDocument, ID: "doc"}
	paragraphBeforeHeading := &ast.Node{Type: ast.NodeParagraph, ID: "p0"}
	heading1 := &ast.Node{Type: ast.NodeHeading, ID: "h1", HeadingLevel: 1}
	paragraph1 := &ast.Node{Type: ast.NodeParagraph, ID: "p1"}
	heading3 := &ast.Node{Type: ast.NodeHeading, ID: "h3", HeadingLevel: 3}
	paragraph2 := &ast.Node{Type: ast.NodeParagraph, ID: "p2"}
	heading2 := &ast.Node{Type: ast.NodeHeading, ID: "h2", HeadingLevel: 2}
	paragraph3 := &ast.Node{Type: ast.NodeParagraph, ID: "p3"}
	heading1Sibling := &ast.Node{Type: ast.NodeHeading, ID: "h1-sibling", HeadingLevel: 1}
	paragraph4 := &ast.Node{Type: ast.NodeParagraph, ID: "p4"}
	for _, node := range []*ast.Node{
		paragraphBeforeHeading,
		heading1,
		paragraph1,
		heading3,
		paragraph2,
		heading2,
		paragraph3,
		heading1Sibling,
		paragraph4,
	} {
		doc.AppendChild(node)
	}

	assertBlockBreadcrumbChildIDs(t, doc, []string{"p0", "h1", "h1-sibling"})
	assertBlockBreadcrumbChildIDs(t, heading1, []string{"p1", "h3", "h2"})
	assertBlockBreadcrumbChildIDs(t, heading3, []string{"p2"})
	assertBlockBreadcrumbChildIDs(t, heading2, []string{"p3"})
	assertBlockBreadcrumbChildIDs(t, heading1Sibling, []string{"p4"})
	assertBlockBreadcrumbChildIDs(t, paragraph1, []string{})
}

func TestEmbedBreadcrumbDocumentTitle(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("title", "Title / Section <A> & B")
	for _, embedded := range []bool{true, false} {
		paths := buildBlockBreadcrumb(treenode.GetNodeInTree(tree, fixture.childID), nil, embedded)
		if len(paths) == 0 || paths[0].ID != tree.Root.ID {
			t.Fatalf("missing document breadcrumb: %+v", paths)
		}
		if embedded {
			if paths[0].DocumentTitle != "Title / Section &lt;A&gt; &amp; B" || paths[0].Name == paths[0].DocumentTitle {
				t.Fatalf("document title must be separate from the unchanged full path: %+v", paths[0])
			}
		} else if paths[0].DocumentTitle != "" {
			t.Fatalf("ordinary breadcrumbs changed: %+v", paths[0])
		}
	}
}

func TestWalkBlockBreadcrumbContainerChildren(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	item1 := &ast.Node{Type: ast.NodeListItem, ID: "item1"}
	item2 := &ast.Node{Type: ast.NodeListItem, ID: "item2"}
	list.AppendChild(item1)
	list.AppendChild(item2)

	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	nestedList := &ast.Node{Type: ast.NodeList, ID: "nested-list"}
	item1.AppendChild(paragraph)
	item1.AppendChild(nestedList)

	assertBlockBreadcrumbChildIDs(t, list, []string{"item1", "item2"})
	assertBlockBreadcrumbChildIDs(t, item1, []string{"paragraph", "nested-list"})
}

func TestCollectBlockBreadcrumbChildren(t *testing.T) {
	doc := &ast.Node{Type: ast.NodeDocument, ID: "doc"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 1}
	headingParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "heading-paragraph"}
	siblingHeading := &ast.Node{Type: ast.NodeHeading, ID: "sibling-heading", HeadingLevel: 1}
	for _, node := range []*ast.Node{paragraph, heading, headingParagraph, siblingHeading} {
		doc.AppendChild(node)
	}

	result := collectBlockBreadcrumbChildren(doc, nil, 1, 1)
	if !result.HasMore {
		t.Fatal("expected more breadcrumb children")
	}
	if 1 != len(result.Items) || heading.ID != result.Items[0].ID {
		t.Fatalf("unexpected paged breadcrumb children: %+v", result.Items)
	}
	if !result.Items[0].HasChildren {
		t.Fatal("expected heading to have breadcrumb children")
	}

	result = collectBlockBreadcrumbChildren(doc, nil, 2, 1)
	if result.HasMore {
		t.Fatal("did not expect more breadcrumb children")
	}
	if 1 != len(result.Items) || siblingHeading.ID != result.Items[0].ID {
		t.Fatalf("unexpected last breadcrumb child: %+v", result.Items)
	}
}

func assertBlockBreadcrumbChildIDs(t *testing.T, node *ast.Node, expected []string) {
	t.Helper()
	actual := []string{}
	walkBlockBreadcrumbChildren(node, func(child *ast.Node) bool {
		actual = append(actual, child.ID)
		return true
	})
	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected breadcrumb children: expected %v, got %v", expected, actual)
	}
}

func TestGetDocBlocksOrdersInTree(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, ID: "doc"}
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	item := &ast.Node{Type: ast.NodeListItem, ID: "item"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("content")})
	item.AppendChild(paragraph)
	list.AppendChild(item)

	blockquote := &ast.Node{Type: ast.NodeBlockquote, ID: "blockquote"}
	quoteParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "quote-paragraph"}
	blockquote.AppendChild(quoteParagraph)

	table := &ast.Node{Type: ast.NodeTable, ID: "table"}
	table.AppendChild(&ast.Node{Type: ast.NodeTableRow, ID: "table-row"})
	emptyIDParagraph := &ast.Node{Type: ast.NodeParagraph}
	blockIAL := &ast.Node{Type: ast.NodeKramdownBlockIAL, ID: "block-ial"}
	for _, node := range []*ast.Node{list, blockquote, table, emptyIDParagraph, blockIAL} {
		root.AppendChild(node)
	}
	tree := &parse.Tree{Root: root}

	expected := []string{"list", "item", "paragraph", "blockquote", "quote-paragraph", "table"}
	if actual := getDocBlocksOrdersInTree(tree); !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected document block orders: expected %v, got %v", expected, actual)
	}
}

func TestGetDocBlocksOrders(t *testing.T) {
	const (
		boxID     = "20260728000100-box0001"
		doc1ID    = "20260728000101-doc0001"
		child1ID  = "20260728000102-para001"
		child1BID = "20260728000103-para002"
	)

	previousDataDir := util.DataDir
	previousBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)

	tree1 := newDocBlocksOrdersTestTree(boxID, doc1ID, []string{child1ID, child1BID})
	if _, err := filesys.WriteTree(tree1); err != nil {
		t.Fatalf("write test tree failed: %v", err)
	}
	treenode.UpsertBlockTree(tree1)

	t.Cleanup(func() {
		cache.RemoveTreeDataInBox(tree1.ID, tree1.Box)
		cache.RemoveDocIALInBox(tree1.Path, tree1.Box)
		treenode.CloseDatabase()
		util.DataDir = previousDataDir
		util.BlockTreeDBPath = previousBlockTreeDBPath
		if "" != previousBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	expected := []string{child1ID, child1BID}
	actual, err := GetDocBlocksOrders(doc1ID)
	if err != nil {
		t.Fatalf("get document block orders failed: %v", err)
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("unexpected document block orders: expected %v, got %v", expected, actual)
	}

	if _, err = GetDocBlocksOrders(child1ID); nil == err {
		t.Fatal("expected a non-document ID to be rejected")
	}
}

func newDocBlocksOrdersTestTree(boxID, docID string, childIDs []string) *parse.Tree {
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Test", "Test")
	tree.Root.FirstChild.Unlink()
	for _, childID := range childIDs {
		tree.Root.AppendChild(treenode.NewParagraph(childID))
	}
	return tree
}

func TestNodeRefTextExcludesInlineMemo(t *testing.T) {
	oldConf := Conf
	Conf = &AppConf{Editor: NewConfSection(conf.NewEditor())}
	t.Cleanup(func() { Conf = oldConf })
	for _, markType := range []string{"inline-memo", "strong inline-memo", "inline-math inline-memo"} {
		t.Run(markType, func(t *testing.T) {
			paragraph := &ast.Node{Type: ast.NodeParagraph}
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("before ")})
			memo := &ast.Node{Type: ast.NodeTextMark, TextMarkType: markType,
				TextMarkTextContent: "visible", TextMarkInlineMathContent: "visible",
				TextMarkInlineMemoContent: "private memo"}
			paragraph.AppendChild(memo)
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" after")})
			for _, container := range []ast.NodeType{ast.NodeParagraph, ast.NodeBlockquote, ast.NodeTabItem} {
				t.Run(container.String(), func(t *testing.T) {
					node := paragraph
					if container == ast.NodeBlockquote {
						node = &ast.Node{Type: container}
						node.AppendChild(cloneRenderNode(paragraph))
					} else if container == ast.NodeTabItem {
						node = &ast.Node{Type: container, TabItemTitle: `<span data-type="inline-memo" data-inline-memo-content="private memo">before visible after</span>`}
					}
					if text := getNodeRefText(node); text != "before visible after" {
						t.Fatalf("unexpected reference text: %q", text)
					}
					if text := getNodeRefText0(node, 10, true); text != "before vis..." {
						t.Fatalf("unexpected truncated reference text: %q", text)
					}
				})
			}
			if memo.TextMarkInlineMemoContent != "private memo" {
				t.Fatal("reference text extraction modified the source memo")
			}
		})
	}
}

func TestUpdateRefTextExcludesInlineMemo(t *testing.T) {
	oldConf := Conf
	Conf = &AppConf{Editor: NewConfSection(conf.NewEditor())}
	t.Cleanup(func() { Conf = oldConf })
	const defID = "20261021000000-def0001"
	t.Cleanup(func() { treenode.DynamicRefTexts.Delete(defID) })
	def := &ast.Node{Type: ast.NodeParagraph, ID: defID}
	memo := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "visible",
		TextMarkInlineMemoContent: "private memo"}
	def.AppendChild(memo)
	refs := &ast.Node{Type: ast.NodeParagraph}
	dynamic := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: defID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "old"}
	static := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: defID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "manual anchor"}
	refs.AppendChild(dynamic)
	refs.AppendChild(static)
	if changed, defs := updateRefText(refs, map[string]*ast.Node{defID: def}); !changed || len(defs) != 1 || defs[0].refText != "visible" {
		t.Fatalf("unexpected dynamic reference update: changed=%v, definitions=%+v", changed, defs)
	}
	if dynamic.TextMarkTextContent != "visible" || static.TextMarkTextContent != "manual anchor" {
		t.Fatalf("unexpected anchors: dynamic=%q, static=%q", dynamic.TextMarkTextContent, static.TextMarkTextContent)
	}
	memo.TextMarkInlineMemoContent = "edited memo"
	if changed, _ := updateRefText(refs, map[string]*ast.Node{defID: def}); changed {
		t.Fatal("editing only the memo changed the reference text")
	}
	if text := getNodeRefText(def); text != dynamic.TextMarkTextContent || memo.TextMarkInlineMemoContent != "edited memo" {
		t.Fatalf("inconsistent reference text or modified source: text=%q, memo=%q", text, memo.TextMarkInlineMemoContent)
	}
}

func TestGetBlockRefTextKeepsInlineMemo(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor.Store(conf.NewEditor())
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	paragraph := tree.Root.FirstChild
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo strong",
		TextMarkTextContent: "visible", TextMarkInlineMemoContent: "private memo"})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	for _, getter := range []struct {
		name string
		text func() string
	}{
		{"default", func() string { return GetBlockRefText(paragraph.ID) }},
		{"in box", func() string { return GetBlockRefTextInBox(paragraph.ID, tree.Box) }},
	} {
		t.Run(getter.name, func(t *testing.T) {
			for range 2 {
				cache.RemoveTreeDataInBox(tree.ID, tree.Box)
				if text := getter.text(); text != "visible" {
					t.Fatalf("unexpected reference text: %q", text)
				}
				loaded, loadErr := LoadTreeByBlockID(paragraph.ID)
				if loadErr != nil {
					t.Fatal(loadErr)
				}
				memo := treenode.GetNodeInTree(loaded, paragraph.ID).FirstChild
				if memo.TextMarkInlineMemoContent != "private memo" {
					t.Fatalf("source memo changed after reading reference text: %q", memo.TextMarkInlineMemoContent)
				}
			}
		})
	}
}
