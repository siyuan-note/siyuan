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

func TestBacklinkRefFilterListContextAndCandidates(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search = conf.NewSearch()
	Conf.Search.BacklinkMentionDoc = true
	const archiveID = "20260909160000-archive"
	const sameNameID = "20260909160001-sameref"
	const itemID = "20260909160002-listitm"
	const keptID = "20260909160003-keepref"
	ref := func(id string) *ast.Node {
		return &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: id,
			TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Same name"}
	}
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if nil != err {
			t.Fatal(err)
		}
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		if id == fixture.sourceID {
			tree.Root.SetIALAttr("title", "BacklinkFilterTopic")
			tree.HPath = "/BacklinkFilterTopic"
			for _, defID := range []string{archiveID, sameNameID} {
				p := treenode.NewParagraph(defID)
				p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Same name")})
				tree.Root.AppendChild(p)
			}
		} else {
			intro := treenode.NewParagraph("20260909160004-intro00")
			intro.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("BacklinkFilterTopic")})
			tree.Root.AppendChild(intro)
			list := &ast.Node{Type: ast.NodeList, ID: "20260909160005-list000", ListData: &ast.ListData{}}
			item := &ast.Node{Type: ast.NodeListItem, ID: itemID, ListData: &ast.ListData{}}
			p := treenode.NewParagraph("20260909160006-ref0000")
			p.AppendChild(ref(fixture.sourceID))
			child := treenode.NewParagraph("20260909160007-child00")
			child.AppendChild(ref(archiveID))
			item.AppendChild(p)
			item.AppendChild(child)
			list.AppendChild(item)
			tree.Root.AppendChild(list)
			kept := treenode.NewParagraph(keptID)
			kept.AppendChild(ref(fixture.sourceID))
			kept.AppendChild(ref(sameNameID))
			tree.Root.AppendChild(kept)
		}
		if _, err = filesys.WriteTree(tree); nil != err {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	sql.FlushQueue()
	filter := &BacklinkSourceFilter{ExcludedRefDefIDs: []string{archiveID}}
	_, all, mentions, allCount, mentionCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", nil, true)
	if len(all) != 1 || allCount != 2 {
		t.Fatalf("expected two entries in one source document: %d, %d", len(all), allCount)
	}
	_, filtered, filteredMentions, count, filteredMentionCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, true)
	if len(filtered) != 1 || count != 1 || filtered[0].Count != 1 {
		t.Fatalf("unexpected filtered list/count: %+v, %d", filtered, count)
	}
	context, _ := GetBacklinkDocInBox(fixture.sourceID, fixture.targetID, "", false, false, "", filter)
	if mentionCount == 0 || mentionCount != filteredMentionCount || !reflect.DeepEqual(mentions, filteredMentions) {
		t.Fatal("excluding direct backlinks changed mentions")
	}
	if len(context) != 1 || context[0].ID != keptID {
		t.Fatalf("list and context filter disagree: %+v", context)
	}
	candidates, err := GetBacklinkRefDefs(fixture.sourceID, "", false, "", filter)
	if nil != err {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, candidate := range candidates {
		ids[candidate.ID] = true
	}
	if !ids[archiveID] || !ids[sameNameID] || !ids[fixture.sourceID] {
		t.Fatalf("candidates should include excluded entries and distinguish equal names: %+v", candidates)
	}
	context, _ = GetBacklinkDocInBox(fixture.sourceID, fixture.targetID, "", false, false, "", nil)
	if len(context) != 2 {
		t.Fatalf("clearing the filter did not restore both entries: %+v", context)
	}
}
