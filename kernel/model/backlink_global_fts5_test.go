//go:build fts5

package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestGlobalBacklinkPagination(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() { ClearGlobalBacklinkSnapshots("") })
	ids := map[int]string{}
	for index, rootID := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(rootID)
		if err != nil {
			t.Fatal(err)
		}
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		for number := 120 - index; number > 0; number -= 2 {
			id := ast.NewNodeID()
			ids[number] = id
			p := treenode.NewParagraph(id)
			p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.sourceID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: fmt.Sprintf("A%d", number)})
			// 同块的第二个引用不能改变排序，也不能增加条目。
			p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.sourceID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "A0"})
			tree.Root.AppendChild(p)
		}
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	sql.FlushQueue()
	query := GlobalBacklinkQuery{ID: fixture.sourceID, Sort: 1}
	allow := func(string) bool { return true }
	token, first, total, start, expired, err := GetGlobalBacklinks(query, "", 0, "", allow)
	if err != nil || expired || total != 120 || start != 0 || len(first) != 50 {
		t.Fatalf("first page: %d %d %v %v", total, len(first), expired, err)
	}
	for offset := 0; offset < 120; offset += 50 {
		_, items, count, page, expired, err := GetGlobalBacklinks(query, token, offset, "", allow)
		if err != nil || expired || count != 120 || page != offset {
			t.Fatalf("page %d: %v %v", offset, expired, err)
		}
		for i, item := range items {
			if item.ID != ids[offset+i+1] || item.Anchor != fmt.Sprintf("A%d", offset+i+1) {
				t.Fatalf("incorrect natural order at %d: %+v", offset+i, item)
			}
		}
	}
	_, _, _, start, expired, err = GetGlobalBacklinks(query, token, 0, ids[103], allow)
	if err != nil || expired || start != 100 {
		t.Fatalf("anchor lookup: %d %v %v", start, expired, err)
	}
	contexts, expired, err := GetGlobalBacklinkContexts(query, token, []string{ids[1], ids[2]}, allow)
	if err != nil || expired || len(contexts) != 2 || contexts[0].ID != ids[1] || strings.Contains(contexts[0].DOM, `data-node-id="`+ids[3]+`"`) {
		t.Fatalf("independent contexts: %+v %v %v", contexts, expired, err)
	}
	if _, _, err = GetGlobalBacklinkContexts(query, token, []string{fixture.targetID}, allow); err == nil {
		t.Fatal("out-of-snapshot block accepted")
	}
	query.Sort = 2
	if _, _, _, _, expired, _ = GetGlobalBacklinks(query, token, 50, "", allow); !expired {
		t.Fatal("cursor reused with different sort")
	}
	_, items, _, _, _, err := GetGlobalBacklinks(query, "", 0, "", allow)
	if err != nil || items[0].ID != ids[120] {
		t.Fatalf("descending order: %v", err)
	}
	query.Sort = 1
	tree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	treenode.GetNodeInTree(tree, ids[1]).FirstChild.TextMarkTextContent = "A1000"
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.UpdateRefsTreeQueue(tree)
	sql.FlushQueue()
	_, items, _, _, expired, err = GetGlobalBacklinks(query, token, 0, "", allow)
	if err != nil || expired || items[0].ID != ids[1] || items[0].Anchor != "A1" {
		t.Fatalf("editing changed the active snapshot: %+v %v %v", items, expired, err)
	}
	_, items, _, _, expired, err = GetGlobalBacklinks(query, "", 0, "", allow)
	if err != nil || expired || items[0].ID != ids[2] {
		t.Fatalf("refresh did not apply edited anchor: %+v %v %v", items, expired, err)
	}
	denySource := func(id string) bool { return id != fixture.sourceID }
	if _, _, _, _, expired, _ = GetGlobalBacklinks(query, token, 50, "", denySource); !expired {
		t.Fatal("revoked source accepted")
	}
	_, _, total, _, _, err = GetGlobalBacklinks(query, "", 0, "", denySource)
	if err != nil || total != 60 {
		t.Fatalf("permission filtered count: %d %v", total, err)
	}
	globalBacklinkSnapshots.Lock()
	globalBacklinkSnapshots.values[token].created = time.Now().Add(-globalBacklinkSnapshotTTL - time.Second)
	globalBacklinkSnapshots.Unlock()
	if _, _, _, _, expired, _ = GetGlobalBacklinks(query, token, 50, "", allow); !expired {
		t.Fatal("expired cursor accepted")
	}
}

func TestGlobalBacklinkSnapshotBounds(t *testing.T) {
	t.Cleanup(func() { ClearGlobalBacklinkSnapshots("") })
	query := GlobalBacklinkQuery{ID: "id", Sort: 1}
	first := ""
	for i := 0; i < globalBacklinkSnapshotLimit+1; i++ {
		token, _, err := globalBacklinkSnapshotPut(query, []*GlobalBacklinkItem{{ID: fmt.Sprint(i)}})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = token
		}
	}
	if globalBacklinkSnapshotGet(query, first, func(string) bool { return true }) != nil {
		t.Fatal("oldest snapshot was not evicted")
	}
	ClearGlobalBacklinkSnapshots("")
	if len(globalBacklinkSnapshots.values) != 0 {
		t.Fatal("snapshot purge left cached entries")
	}
	converted, _, err := globalBacklinkSnapshotPut(query, []*GlobalBacklinkItem{{ID: "id", Box: "locked"}})
	if err != nil {
		t.Fatal(err)
	}
	query.Notebook = "unrelated"
	retained, _, err := globalBacklinkSnapshotPut(query, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ClearGlobalBacklinkSnapshots("unrelated") })
	ClearGlobalBacklinkSnapshots("locked")
	if globalBacklinkSnapshots.values[converted] != nil || globalBacklinkSnapshots.values[retained] == nil {
		t.Fatal("notebook purge did not isolate affected source snapshots")
	}
}

// 使用真实文档和引用索引验证万条反链，耗时只作观测，避免按机器速度设置脆弱阈值。
func TestGlobalBacklinkLargeDataset(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() { ClearGlobalBacklinkSnapshots("") })
	const documents, perDocument = 100, 100
	definition, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	sql.IndexTreeQueue(definition)
	for doc := 0; doc < documents; doc++ {
		tree := addFileOperationTestDoc(t, fixture, ast.NewNodeID(), fmt.Sprintf("Source%d", doc), false)
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		for index := perDocument - 1; index >= 0; index-- {
			p := treenode.NewParagraph(ast.NewNodeID())
			p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.sourceID,
				TextMarkBlockRefSubtype: "s", TextMarkTextContent: fmt.Sprintf("A%d", index*documents+doc+1)})
			tree.Root.AppendChild(p)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	sql.FlushQueue()
	query := GlobalBacklinkQuery{ID: fixture.sourceID, Sort: 1}
	allow := func(string) bool { return true }
	started := time.Now()
	token, first, total, _, expired, err := GetGlobalBacklinks(query, "", 0, "", allow)
	initialDuration := time.Since(started)
	if err != nil || expired || total != documents*perDocument || len(first) != GlobalBacklinkPageSize {
		t.Fatalf("large first page: %d %d %v %v", total, len(first), expired, err)
	}
	seen := map[string]bool{}
	started = time.Now()
	for offset := 0; offset < total; offset += GlobalBacklinkPageSize {
		_, items, count, page, expired, err := GetGlobalBacklinks(query, token, offset, "", allow)
		if err != nil || expired || count != total || page != offset {
			t.Fatalf("large page %d: %v %v", offset, expired, err)
		}
		for index, item := range items {
			if seen[item.ID] || item.Anchor != fmt.Sprintf("A%d", offset+index+1) {
				t.Fatalf("duplicate or unsorted large result: %+v", item)
			}
			seen[item.ID] = true
		}
	}
	pagesDuration := time.Since(started)
	if len(seen) != total {
		t.Fatalf("missing large results: %d of %d", len(seen), total)
	}
	var ids []string
	for _, item := range first[:16] {
		ids = append(ids, item.ID)
	}
	started = time.Now()
	contexts, expired, err := GetGlobalBacklinkContexts(query, token, ids, allow)
	if err != nil || expired || len(contexts) != len(ids) {
		t.Fatalf("large contexts: %d %v %v", len(contexts), expired, err)
	}
	t.Logf("%d references / %d documents: initial=%s, %d cached pages=%s, 16 contexts=%s, snapshot=%d bytes",
		total, documents, initialDuration, total/GlobalBacklinkPageSize, pagesDuration, time.Since(started), globalBacklinkSnapshots.values[token].bytes)
}
