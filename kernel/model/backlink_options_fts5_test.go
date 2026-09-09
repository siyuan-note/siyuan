//go:build fts5

package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBacklink2OptionalMentions(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search = conf.NewSearch()
	Conf.Search.BacklinkMentionDoc = true
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			t.Fatal(err)
		}
		if id == fixture.sourceID {
			tree.Root.SetIALAttr("title", "BacklinkTarget")
			tree.HPath = "/BacklinkTarget"
		} else {
			for child := tree.Root.FirstChild; child != nil; {
				next := child.Next
				child.Unlink()
				child = next
			}
			ref := treenode.NewParagraph("20260909150000-ref0001")
			ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
				TextMarkBlockRefID: fixture.sourceID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "BacklinkTarget"})
			tree.Root.AppendChild(ref)
			mention := treenode.NewParagraph("20260909150001-mention")
			mention.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("BacklinkTarget")})
			tree.Root.AppendChild(mention)
		}
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	sql.FlushQueue()
	if refs := sql.QueryRefsByDefID(fixture.sourceID, false); len(refs) != 1 {
		t.Fatalf("fixture reference was not indexed: %+v", refs)
	}
	box, links, mentions, linkCount, mentionCount := GetBacklink2InBoxWithFilter(fixture.sourceID, "", "", 0, 0, false, "", nil)
	if len(links) != 1 || linkCount != 1 || len(mentions) != 1 || mentionCount != 1 {
		t.Fatalf("fixture should contain one backlink and one mention: %d/%d, %d/%d", len(links), linkCount, len(mentions), mentionCount)
	}
	gotBox, gotLinks, gotMentions, gotLinkCount, gotMentionCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", nil, false)
	if gotBox != box || !reflect.DeepEqual(gotLinks, links) || gotLinkCount != linkCount {
		t.Fatal("omitting mentions changed the backlink results")
	}
	if gotMentions == nil || len(gotMentions) != 0 || gotMentionCount != 0 {
		t.Fatalf("omitted mentions must remain an empty array with zero count: %+v, %d", gotMentions, gotMentionCount)
	}
}
