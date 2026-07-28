package model

import (
	"reflect"
	"testing"
	"time"

	"github.com/88250/lute/ast"
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

func TestBlockBreadcrumbTreeCache(t *testing.T) {
	const sessionID = "breadcrumb-cache-test"
	cacheKey := "\x00" + sessionID
	node := &ast.Node{Type: ast.NodeParagraph, ID: "cached-node"}
	entry := &blockBreadcrumbTreeCacheEntry{
		nodes:     map[string]*ast.Node{node.ID: node},
		expiresAt: time.Now().Add(time.Hour),
		timer:     time.NewTimer(time.Hour),
	}

	blockBreadcrumbTreeCache.Lock()
	blockBreadcrumbTreeCache.entries[cacheKey] = entry
	blockBreadcrumbTreeCache.Unlock()
	t.Cleanup(func() {
		blockBreadcrumbTreeCache.Lock()
		if current := blockBreadcrumbTreeCache.entries[cacheKey]; nil != current {
			current.timer.Stop()
			delete(blockBreadcrumbTreeCache.entries, cacheKey)
		}
		blockBreadcrumbTreeCache.Unlock()
	})

	cachedNode, err := loadBlockBreadcrumbNode(node.ID, "", sessionID)
	if nil != err {
		t.Fatal(err)
	}
	if cachedNode != node {
		t.Fatalf("unexpected cached breadcrumb node: %+v", cachedNode)
	}

	blockBreadcrumbTreeCache.Lock()
	entry.expiresAt = time.Now().Add(-time.Second)
	cleanupBlockBreadcrumbTreeCache(time.Now())
	_, cached := blockBreadcrumbTreeCache.entries[cacheKey]
	blockBreadcrumbTreeCache.Unlock()
	if cached {
		t.Fatal("expected expired breadcrumb tree cache to be removed")
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
