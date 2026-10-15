package model

import (
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCalloutTitleReferenceTextUpdate(t *testing.T) {
	const defID = "20261015120000-ref0001"
	def := &ast.Node{Type: ast.NodeDocument, ID: defID}
	def.SetIALAttr("name", "New title")
	t.Cleanup(func() { treenode.DynamicRefTexts.Delete(defID) })
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(),
		CalloutTitle: `((` + defID + ` "Static")) <span data-type="block-ref" data-id="` + defID + `" data-subtype="d">Old title</span>`}
	body := treenode.NewParagraph("")
	callout.AppendChild(body)
	if ids := getRefDefIDs(callout); !slices.Equal(ids, []string{defID}) {
		t.Fatalf("title targets must be collected once, got %v", ids)
	}
	changed, defs := updateRefText(callout, map[string]*ast.Node{defID: def})
	if !changed || len(defs) != 1 || defs[0].id != defID || defs[0].refText != "New title" {
		t.Fatalf("dynamic title update was not reported: %v %+v", changed, defs)
	}
	if !strings.Contains(callout.CalloutTitle, "Static") || !strings.Contains(callout.CalloutTitle, "New title") ||
		strings.Contains(callout.CalloutTitle, "Old title") || callout.FirstChild != body {
		t.Fatal("dynamic title update changed static text or body")
	}
	if changed, _ = updateRefText(callout, map[string]*ast.Node{defID: def}); changed {
		t.Fatal("unchanged dynamic text must not rewrite the title")
	}
}

func TestCalloutTitleReferenceBoundary(t *testing.T) {
	const allowedID = "20261015120000-ref0001"
	const missingID = "20261015120000-ref0002"
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(),
		CalloutTitle: `((` + allowedID + ` 'Allowed')) ((` + missingID + ` 'Private anchor'))`}
	callout.AppendChild(treenode.NewParagraph(""))
	if count := degradeCrossBoundaryBlockRefsWithAllowed(callout, "20261015120000-box0001", nil, map[string]bool{allowedID: true}); count != 1 {
		t.Fatalf("expected one denied title reference, got %d", count)
	}
	if strings.Contains(callout.CalloutTitle, missingID) || !strings.Contains(callout.CalloutTitle, "Private anchor") {
		t.Fatalf("denied title reference must retain only its anchor: %s", callout.CalloutTitle)
	}
	if ids := getRefDefIDs(callout); !slices.Equal(ids, []string{allowedID}) {
		t.Fatalf("denied reference must not enter the index: %v", ids)
	}
	callout.CalloutTitle = "((" + callout.FirstChild.ID + " 'Local'))"
	if count := degradeCrossBoundaryBlockRefs(callout, "20261015120000-box0001"); count != 0 {
		t.Fatal("references to new blocks in the same subtree must survive")
	}
}
