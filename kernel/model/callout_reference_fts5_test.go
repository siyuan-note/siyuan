//go:build fts5

package model

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func calloutReferenceTestProcess(t *testing.T) bool {
	t.Helper()
	const helper = "SIYUAN_TEST_CALLOUT_REFERENCE"
	if os.Getenv(helper) == t.Name() {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
	command.Env = append(os.Environ(), helper+"="+t.Name())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("callout reference subprocess: %v\n%s", err, output)
	}
	return false
}

func TestCalloutTitleReferenceLifecycle(t *testing.T) {
	if !calloutReferenceTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	testCalloutTitleReferenceLifecycle(t, box.ID)
}

func testCalloutTitleReferenceLifecycle(t *testing.T, boxID string) {
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	reference := newHPathTestDoc(t, boxID, "/", "Reference", 1)
	l := util.NewLute()
	save := func(tree *parse.Tree) {
		t.Helper()
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.FlushQueue()
	}
	save(definition)
	save(reference)
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitleExplicit: true,
		CalloutTitle: `<span data-type="block-ref" data-id="` + definition.ID + `" data-subtype="d">Definition</span> ((` + definition.ID + ` "Static"))`}
	callout.SetIALAttr("id", callout.ID)
	callout.AppendChild(treenode.NewParagraph(""))
	perform := func(op *Operation) {
		t.Helper()
		if err := PerformTxSync(&Transaction{DoOperations: []*Operation{op}}); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
	}
	assertRefs := func(want int) {
		t.Helper()
		refs := sql.QueryRefsByDefIDInBox(definition.ID, false, boxID)
		if len(refs) != want {
			t.Fatalf("reference count: got %d, want %d", len(refs), want)
		}
		if want == 1 && (refs[0].BlockID != callout.ID || refs[0].RootID != reference.ID) {
			t.Fatalf("incorrect persisted title reference ownership: %+v", refs[0])
		}
	}
	readCallout := func() *ast.Node {
		t.Helper()
		tree, err := filesys.LoadTree(boxID, reference.Path, l)
		if err != nil {
			t.Fatal(err)
		}
		node := treenode.GetNodeInTree(tree, callout.ID)
		if node == nil || node.Type != ast.NodeCallout || node.FirstChild == nil || node.FirstChild.Next != nil {
			t.Fatal("persisted callout must retain its body without temporary title blocks")
		}
		return node
	}
	perform(&Operation{Action: "insert", ID: callout.ID, ParentID: reference.ID, Data: l.RenderNodeBlockDOM(callout)})
	assertRefs(1)
	callout = readCallout()

	treenode.SetDynamicBlockRefText(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
		TextMarkBlockRefID: definition.ID, Box: boxID}, "Cached title")
	t.Cleanup(func() {
		treenode.DynamicRefTexts.Delete(definition.ID)
		treenode.RemoveDynamicRefTexts(boxID)
	})
	perform(&Operation{Action: "update", ID: callout.ID, Data: l.RenderNodeBlockDOM(callout)})
	callout = readCallout()
	if !strings.Contains(callout.CalloutTitle, "Cached title") || !strings.Contains(callout.CalloutTitle, "Static") {
		t.Fatalf("transaction did not normalize dynamic title text: %s", callout.CalloutTitle)
	}
	assertRefs(1)

	definition.Root.SetIALAttr("title", "Renamed definition")
	save(definition)
	refreshDynamicRefText(definition.Root, definition)
	sql.FlushQueue()
	callout = readCallout()
	if !strings.Contains(callout.CalloutTitle, "Renamed definition") || !strings.Contains(callout.CalloutTitle, "Static") {
		t.Fatalf("rename did not persist the dynamic title anchor: %s", callout.CalloutTitle)
	}
	assertRefs(1)
	backlinks, _ := GetBacklinkDoc(definition.ID, reference.ID, "", false, false)
	if len(backlinks) == 0 {
		t.Fatal("title references must be visible through the backlink query")
	}

	callout.CalloutTitle = "Plain title"
	perform(&Operation{Action: "update", ID: callout.ID, Data: l.RenderNodeBlockDOM(callout)})
	assertRefs(0)
	callout = readCallout()
	callout.CalloutTitle = "((" + definition.ID + ` "Restored"))`
	perform(&Operation{Action: "update", ID: callout.ID, Data: l.RenderNodeBlockDOM(callout)})
	assertRefs(1)
	perform(&Operation{Action: "delete", ID: callout.ID})
	assertRefs(0)
}
