// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestCalloutTitleWalkerOwnershipAndRewrite(t *testing.T) {
	title := `**Title** <span data-type="block-ref" data-id="20261015120000-ref0001" data-subtype="d">Dynamic</span> ((20261015120000-ref0002 "Static"))`
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE",
		CalloutTitle: title, CalloutTitleExplicit: true, CalloutIcon: "custom-icon.png", CalloutIconType: 1}
	body := NewParagraph("")
	callout.AppendChild(body)
	refs, exits := 0, 0
	WalkWithInlineTitles(callout, func(n *ast.Node, entering bool) ast.WalkStatus {
		if IsBlockRef(n) {
			if ParentBlock(n) != callout {
				t.Fatal("title reference must belong to the callout")
			}
			if entering {
				refs++
			} else {
				exits++
			}
		}
		return ast.WalkContinue
	})
	if refs != 2 || exits != 2 || callout.CalloutTitle != title || callout.FirstChild != body || body.Previous != nil {
		t.Fatal("read traversal missed references or changed the source")
	}
	WalkWithInlineTitles(callout, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(n) && n.TextMarkBlockRefSubtype == "d" {
			n.TextMarkBlockRefID = "20261015120000-ref0003"
			n.TextMarkTextContent = "Renamed"
		}
		return ast.WalkContinue
	})
	if !strings.Contains(callout.CalloutTitle, "ref0003") || !strings.Contains(callout.CalloutTitle, "Renamed") ||
		!strings.Contains(callout.CalloutTitle, "Static") || callout.FirstChild != body || body.Next != nil ||
		callout.CalloutIcon != "custom-icon.png" || callout.CalloutIconType != 1 || !callout.CalloutTitleExplicit {
		t.Fatalf("title rewrite changed callout structure or attributes: %+v", callout)
	}
}

func TestInlineTitleWalkerControlFlow(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeCallout, ast.NodeTabItem} {
		for _, status := range []ast.WalkStatus{ast.WalkSkipChildren, ast.WalkStop} {
			root := &ast.Node{Type: typ, ID: ast.NewNodeID(), CalloutTitle: "Title", TabItemTitle: "Title"}
			root.AppendChild(NewParagraph(""))
			visits := 0
			WalkWithInlineTitles(root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering {
					visits++
					return status
				}
				return ast.WalkContinue
			})
			if visits != 1 {
				t.Fatalf("type %s status %d visited skipped content", typ, status)
			}
		}
	}
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutTitle: "Title"}
	callout.AppendChild(NewParagraph(""))
	visits := 0
	WalkWithInlineTitles(callout, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			visits++
			if !n.IsBlock() {
				return ast.WalkStop
			}
		}
		return ast.WalkContinue
	})
	if visits != 2 {
		t.Fatal("stopping in the title must stop before visiting the body")
	}
}

func TestMaterializeInlineTitlesRewriteAndNesting(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeCallout, ast.NodeTabItem} {
		title := `**Title** ((20261015120000-ref0001 "Reference"))`
		node := &ast.Node{Type: typ, ID: ast.NewNodeID(), CalloutTitle: title, TabItemTitle: title}
		body := NewParagraph("")
		node.AppendChild(body)
		finish := MaterializeInlineTitles(node)
		finishNested := MaterializeInlineTitles(node)
		refs := 0
		WalkWithInlineTitles(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && IsBlockRef(n) {
				refs++
			}
			return ast.WalkContinue
		})
		finishNested()
		finish()
		finish()
		if refs != 1 || node.FirstChild != body || body.Previous != nil || node.CalloutTitle != title || node.TabItemTitle != title {
			t.Fatalf("type %s duplicated or changed a materialized title", typ)
		}
		finish = MaterializeInlineTitlesForExport(node)
		var unlinks []*ast.Node
		WalkWithInlineTitles(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && IsBlockRef(n) {
				n.InsertBefore(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "Reference", TextMarkAHref: "Target.md"})
				unlinks = append(unlinks, n)
			}
			return ast.WalkContinue
		})
		for _, n := range unlinks {
			n.Unlink()
		}
		finish()
		updated := node.CalloutTitle
		if typ == ast.NodeTabItem {
			updated = node.TabItemTitle
		}
		if !strings.Contains(updated, "[Reference](Target.md)") || strings.Contains(updated, "block-ref") || node.FirstChild != body {
			t.Fatalf("type %s did not retain the exported link: %s", typ, updated)
		}
	}
}
