// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeListItemBlockUpdateTree(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	list := &ast.Node{Type: ast.NodeList}
	firstItem := &ast.Node{Type: ast.NodeListItem, ID: "first-item"}
	firstItem.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "paragraph"})
	secondItem := &ast.Node{Type: ast.NodeListItem, ID: "second-item"}
	list.AppendChild(firstItem)
	list.AppendChild(secondItem)
	root.AppendChild(list)

	oldNode := &ast.Node{Type: ast.NodeListItem, ID: "old-item"}
	normalizedTree, updatedNode, err := normalizeBlockUpdateTree(oldNode, &parse.Tree{Root: root}, util.NewLute())
	if err != nil {
		t.Fatalf("normalize list item update failed: %s", err)
	}
	if ast.NodeListItem != updatedNode.Type || "first-item" != updatedNode.ID {
		t.Fatalf("unexpected normalized node [%s] [%s]", updatedNode.Type.String(), updatedNode.ID)
	}
	if normalizedTree.Root.FirstChild != updatedNode || normalizedTree.Root.LastChild != updatedNode || nil != updatedNode.Next {
		t.Fatal("normalized update tree should contain only the first list item")
	}
}

func TestResolveSuperBlockListItemAfterBlockDOMRoundTrip(t *testing.T) {
	const oldID = "20260731010000-olditem"

	superBlock := &ast.Node{Type: ast.NodeSuperBlock, ID: "20260731010001-superbk"}
	oldItem := &ast.Node{Type: ast.NodeListItem, ID: oldID}
	superBlock.AppendChild(oldItem)

	luteEngine := util.NewLute()
	blockDOM, _ := luteEngine.Md2BlockDOMTree("* updated", true)
	dataTree := luteEngine.BlockDOM2Tree(blockDOM)
	normalizedTree, updatedNode, err := normalizeBlockUpdateTree(oldItem, dataTree, luteEngine)
	if err != nil {
		t.Fatalf("normalize super block list item failed: %s", err)
	}
	updatedNode.SetIALAttr("id", oldID)

	normalizedDOM := luteEngine.Tree2BlockDOM(normalizedTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	transactionTree := luteEngine.BlockDOM2Tree(normalizedDOM)
	if ast.NodeList != firstContentBlock(transactionTree.Root).Type {
		t.Fatal("standalone list item DOM should be wrapped in a list when parsed")
	}

	resolvedNode, err := resolveBlockUpdateNode(oldItem, transactionTree.Root)
	if err != nil {
		t.Fatalf("resolve super block list item failed: %s", err)
	}
	if ast.NodeListItem != resolvedNode.Type || oldID != resolvedNode.ID {
		t.Fatalf("unexpected resolved node [%s] [%s]", resolvedNode.Type.String(), resolvedNode.ID)
	}
	if err = treenode.ValidateBlockReplacement(oldItem, resolvedNode); err != nil {
		t.Fatalf("super block list item replacement should be valid: %s", err)
	}
}

func TestBuildBlockUpdateOperationsCachesTrees(t *testing.T) {
	const (
		boxID    = "20260731010100-box0001"
		rootID   = "20260731010101-root001"
		firstID  = "20260731010102-first01"
		secondID = "20260731010103-second1"
	)

	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	root.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: firstID})
	root.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: secondID})
	tree := &parse.Tree{ID: rootID, Box: boxID, Root: root}

	loadCount := 0
	operations, rootIDs, err := buildBlockUpdateOperations([]BlockUpdateInput{
		{ID: firstID, Data: "first", DataType: "markdown"},
		{ID: secondID, Data: "second", DataType: "markdown"},
	}, func(id string) *treenode.BlockTree {
		return &treenode.BlockTree{ID: id, RootID: rootID, BoxID: boxID}
	}, func(id string) (*parse.Tree, error) {
		loadCount++
		return tree, nil
	})
	if err != nil {
		t.Fatalf("build cached block updates failed: %s", err)
	}
	if 1 != loadCount {
		t.Fatalf("expected the shared tree to be loaded once, got [%d]", loadCount)
	}
	if 2 != len(operations) || 1 != len(rootIDs) || rootID != rootIDs[0] {
		t.Fatalf("unexpected build result: operations [%d], root IDs [%v]", len(operations), rootIDs)
	}
}

func TestPerformBlockUpdatesReturnsExecutionError(t *testing.T) {
	transactions, rootIDs, err := performBlockUpdates(nil, func(inputs []BlockUpdateInput) ([]*Operation, []string, error) {
		return []*Operation{{
			Action: "update",
			ID:     "20260731010200-invalid",
		}}, nil, nil
	})
	if nil == err {
		t.Fatal("expected synchronous block update execution error")
	}
	if nil != transactions || nil != rootIDs {
		t.Fatalf("failed block updates should not return transactions or root IDs: [%v] [%v]", transactions, rootIDs)
	}
}

func TestValidateBlockUpdateType(t *testing.T) {
	oldNode := &ast.Node{Type: ast.NodeCodeBlock, ID: "code"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	if err := validateBlockUpdateType(oldNode, paragraph, false); nil != err {
		t.Fatalf("unlocked type update should be allowed: %s", err)
	}
	if err := validateBlockUpdateType(oldNode, paragraph, true); nil == err {
		t.Fatal("locked type update should be rejected")
	}

	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading"}
	if err := validateBlockUpdateType(heading, &ast.Node{Type: ast.NodeHeading}, true); nil != err {
		t.Fatalf("heading subtype update should be allowed: %s", err)
	}

	emptyParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "empty-paragraph"}
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil != err {
		t.Fatalf("empty paragraph conversion should be allowed: %s", err)
	}

	emptyParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("\u200b \n")})
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil != err {
		t.Fatalf("paragraph containing only blank text should be convertible: %s", err)
	}
	emptyParagraph.FirstChild.Tokens = []byte("content")
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil == err {
		t.Fatal("non-empty paragraph conversion should be rejected")
	}
}

func TestDataBlockDOMEmptyData(t *testing.T) {
	data, err := DataBlockDOM("", util.NewLute())
	if err != nil {
		t.Fatalf("convert empty markdown failed: %s", err)
	}
	if "" == data {
		t.Fatal("empty markdown should produce a blank paragraph")
	}
}

const (
	updateTestBoxID = "20260804000000-box0001"
	updateTestRoot  = "20260804000001-root001"
	updateTestList  = "20260804000002-list001"
	updateTestItem1 = "20260804000003-item001"
	updateTestPara1 = "20260804000004-para001"
	updateTestItem2 = "20260804000005-item002"
	updateTestPara2 = "20260804000006-para002"
)

func TestBuildBlockUpdateOperationsPinsDescendantIDs(t *testing.T) {
	testCases := []struct {
		name     string
		id       string
		data     string
		wantKeep map[string]bool
		wantAll  bool
	}{
		{
			name: "structure preserved on text edit",
			id:   updateTestList,
			data: "- edited a\n- edited b",
			wantKeep: map[string]bool{
				updateTestList: true, updateTestItem1: true, updateTestPara1: true,
				updateTestItem2: true, updateTestPara2: true,
			},
			wantAll: true,
		},
		{
			name: "appended item keeps surviving IDs",
			id:   updateTestList,
			data: "- a\n- b\n- c",
			wantKeep: map[string]bool{
				updateTestList: true, updateTestItem1: true, updateTestPara1: true,
				updateTestItem2: true, updateTestPara2: true,
			},
			wantAll: false,
		},
		{
			name: "nested list inserted mid keeps surviving IDs",
			id:   updateTestList,
			data: "- a\n  - a1\n- b",
			wantKeep: map[string]bool{
				updateTestList: true, updateTestItem1: true, updateTestPara1: true,
				updateTestItem2: true, updateTestPara2: true,
			},
			wantAll: false,
		},
		{
			name: "list item update pins item and its paragraph",
			id:   updateTestItem1,
			data: "- edited a",
			wantKeep: map[string]bool{
				updateTestItem1: true, updateTestPara1: true,
			},
			wantAll: false,
		},
	}
	for _, tc := range testCases {
		operations, _, err := buildTestBlockUpdateOperations(tc.id, tc.data)
		if err != nil {
			t.Fatalf("%s: build block update operations failed: %s", tc.name, err)
		}
		if 1 != len(operations) {
			t.Fatalf("%s: expected one operation, got [%d]", tc.name, len(operations))
		}
		data, ok := operations[0].Data.(string)
		if !ok {
			t.Fatalf("%s: operation data is not a string", tc.name)
		}
		ids := parseBlockUpdateDOMIDs(t, tc.name, data)
		if tc.wantAll && len(ids) != len(tc.wantKeep) {
			t.Fatalf("%s: expected [%d] block IDs, got [%d] [%v]", tc.name, len(tc.wantKeep), len(ids), ids)
		}
		for wantID := range tc.wantKeep {
			if _, ok := ids[wantID]; !ok {
				t.Fatalf("%s: block ID [%s] was not preserved, got [%v]", tc.name, wantID, ids)
			}
		}
	}
}

func buildTestBlockUpdateOperations(id, data string) ([]*Operation, []string, error) {
	root := &ast.Node{Type: ast.NodeDocument, ID: updateTestRoot}
	list := &ast.Node{Type: ast.NodeList, ID: updateTestList}
	firstItem := &ast.Node{Type: ast.NodeListItem, ID: updateTestItem1}
	firstItem.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: updateTestPara1})
	secondItem := &ast.Node{Type: ast.NodeListItem, ID: updateTestItem2}
	secondItem.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: updateTestPara2})
	list.AppendChild(firstItem)
	list.AppendChild(secondItem)
	root.AppendChild(list)
	tree := &parse.Tree{ID: updateTestRoot, Box: updateTestBoxID, Root: root}

	return buildBlockUpdateOperations([]BlockUpdateInput{{
		ID: id, Data: data, DataType: "markdown",
	}}, func(blockID string) *treenode.BlockTree {
		return &treenode.BlockTree{ID: blockID, RootID: updateTestRoot, BoxID: updateTestBoxID}
	}, func(blockID string) (*parse.Tree, error) {
		return tree, nil
	})
}

func parseBlockUpdateDOMIDs(t *testing.T, name, data string) map[string]bool {
	tree := util.NewLute().BlockDOM2Tree(data)
	if nil == tree || nil == tree.Root {
		t.Fatalf("%s: parse block DOM failed", name)
	}
	ids := map[string]bool{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || ast.NodeKramdownBlockIAL == n.Type || "" == n.ID {
			return ast.WalkContinue
		}
		ids[n.ID] = true
		return ast.WalkContinue
	})
	return ids
}
