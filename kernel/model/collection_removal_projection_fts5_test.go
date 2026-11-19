// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func projectionTestBlock(typ ast.NodeType, text string) *ast.Node {
	node := &ast.Node{ID: ast.NewNodeID(), Type: typ}
	node.SetIALAttr("id", node.ID)
	if typ == ast.NodeHeading {
		node.HeadingLevel = 1
	}
	if typ == ast.NodeBlockquote {
		node.AppendChild(&ast.Node{Type: ast.NodeBlockquoteMarker, Tokens: []byte(">")})
	}
	if text != "" {
		node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
	}
	return node
}

func projectionTestReference(target string) *ast.Node {
	node := projectionTestBlock(ast.NodeParagraph, "Source ")
	node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
	return node
}

func projectionTestDOM(node *ast.Node) string {
	return util.NewLute().RenderNodeBlockDOM(node)
}

func projectionTestList(paragraph *ast.Node) (*ast.Node, *ast.Node) {
	list, item := projectionTestBlock(ast.NodeList, ""), projectionTestBlock(ast.NodeListItem, "")
	list.ListData = &ast.ListData{Typ: 0, BulletChar: '*'}
	item.ListData = &ast.ListData{Typ: 0, BulletChar: '*'}
	item.AppendChild(paragraph)
	list.AppendChild(item)
	return list, item
}

func TestCollectionRemovalProjectionMatchesTransactions(t *testing.T) {
	tests := []struct {
		name  string
		build func(*fileOperationTestFixture, *parse.Tree, *parse.Tree) []*Operation
	}{
		{"replace reference and retain another", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			paragraph := projectionTestReference(target.ID)
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: source.ID,
				TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Other"})
			source.Root.AppendChild(paragraph)
			replacement := cloneBlockSwapNode(paragraph)
			replacement.FirstChild.Next.Unlink()
			return []*Operation{{Action: "update", ID: paragraph.ID, Data: projectionTestDOM(replacement)}}
		}},
		{"preserve folded children omitted from container DOM", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(heading, true)
			quote.AppendChild(heading)
			quote.AppendChild(projectionTestReference(target.ID))
			source.Root.AppendChild(quote)
			replacement := projectionTestBlock(ast.NodeBlockquote, "")
			replacement.ID = quote.ID
			replacement.SetIALAttr("id", quote.ID)
			replacement.AppendChild(cloneBlockSwapNode(heading))
			return []*Operation{{Action: "update", ID: quote.ID, Data: projectionTestDOM(replacement)}}
		}},
		{"insert parent update new child and move existing block", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			paragraph := projectionTestReference(target.ID)
			quote.AppendChild(paragraph)
			insert := projectionTestDOM(quote)
			paragraph.LastChild.Unlink()
			return []*Operation{
				{Action: "insert", ID: quote.ID, PreviousID: f.childID, Data: insert},
				{Action: "update", ID: paragraph.ID, Data: projectionTestDOM(paragraph)},
				{Action: "move", ID: f.childID, ParentID: quote.ID},
				{Action: "setAttrs", ID: quote.ID, Data: `{"custom-state":" ready "}`},
			}
		}},
		{"reference to a previously inserted target survives", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			definition := projectionTestBlock(ast.NodeParagraph, "New target")
			reference := projectionTestReference(definition.ID)
			reference.ID = f.childID
			reference.SetIALAttr("id", reference.ID)
			return []*Operation{{Action: "insert", ID: definition.ID, PreviousID: f.childID, Data: projectionTestDOM(definition)},
				{Action: "update", ID: f.childID, Data: projectionTestDOM(reference)}}
		}},
		{"reference to a future target is degraded in operation order", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			definition := projectionTestBlock(ast.NodeParagraph, "Future target")
			reference := projectionTestReference(definition.ID)
			reference.ID = f.childID
			reference.SetIALAttr("id", reference.ID)
			return []*Operation{{Action: "update", ID: f.childID, Data: projectionTestDOM(reference)},
				{Action: "insert", ID: definition.ID, PreviousID: f.childID, Data: projectionTestDOM(definition)}}
		}},
		{"reference to a deleted target does not use the old index", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			definition := projectionTestBlock(ast.NodeParagraph, "Deleted target")
			source.Root.AppendChild(definition)
			reference := projectionTestReference(definition.ID)
			reference.ID = f.childID
			reference.SetIALAttr("id", reference.ID)
			return []*Operation{{Action: "delete", ID: definition.ID},
				{Action: "update", ID: f.childID, Data: projectionTestDOM(reference)}}
		}},
		{"delete and reinsert same identity", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			paragraph := treenode.GetNodeInTree(source, f.childID)
			return []*Operation{{Action: "delete", ID: paragraph.ID},
				{Action: "insert", ID: paragraph.ID, ParentID: source.ID, Data: projectionTestDOM(paragraph)}}
		}},
		{"insert uses next anchor ahead of previous and parent", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			a, b := projectionTestBlock(ast.NodeParagraph, "A"), projectionTestBlock(ast.NodeParagraph, "B")
			source.Root.AppendChild(a)
			source.Root.AppendChild(b)
			insert := projectionTestReference(target.ID)
			return []*Operation{{Action: "insert", ID: insert.ID, NextID: a.ID, PreviousID: b.ID,
				ParentID: source.ID, Data: projectionTestDOM(insert)}}
		}},
		{"insert after folded heading follows its section", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			insert := projectionTestBlock(ast.NodeParagraph, "After section")
			return []*Operation{{Action: "foldHeading", ID: heading.ID},
				{Action: "insert", ID: insert.ID, PreviousID: heading.ID, Data: projectionTestDOM(insert)}}
		}},
		{"unfold before insertion changes anchor placement", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(heading, true)
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			insert := projectionTestBlock(ast.NodeParagraph, "Inside section")
			return []*Operation{{Action: "unfoldHeading", ID: heading.ID},
				{Action: "insert", ID: insert.ID, PreviousID: heading.ID, Data: projectionTestDOM(insert)}}
		}},
		{"heading demotion unfolds newly containing section", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			parent, heading := projectionTestBlock(ast.NodeHeading, "Parent"), projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(parent, true)
			source.Root.AppendChild(parent)
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			changed := cloneBlockSwapNode(heading)
			changed.HeadingLevel = 2
			insert := projectionTestBlock(ast.NodeParagraph, "Immediately after parent")
			return []*Operation{{Action: "update", ID: heading.ID, Data: projectionTestDOM(changed)},
				{Action: "insert", ID: insert.ID, PreviousID: parent.ID, Data: projectionTestDOM(insert)}}
		}},
		{"move folded heading across documents", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(heading, true)
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			return []*Operation{{Action: "move", ID: heading.ID, ParentID: target.ID}}
		}},
		{"move before sibling retains group ordering", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(heading, true)
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			return []*Operation{{Action: "move", ID: heading.ID, NextID: f.childID}}
		}},
		{"append moves to document end rather than anchor child", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			quote.AppendChild(projectionTestBlock(ast.NodeParagraph, "Existing"))
			target.Root.AppendChild(quote)
			// 空文档在 cleanup 之后的提交落盘阶段补入随机 ID 的空段，此例只比较移动位置。
			source.Root.AppendChild(projectionTestBlock(ast.NodeParagraph, "Remaining source content"))
			return []*Operation{{Action: "append", ID: f.childID, ParentID: quote.ID}}
		}},
		{"append preserves folded heading despite move-only context", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			treenode.SetSelfFolded(heading, true)
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			return []*Operation{{Action: "append", ID: heading.ID, ParentID: target.ID,
				Context: map[string]interface{}{"removeFold": "true"}}}
		}},
		{"append accepts a descendant as its document lookup anchor", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			paragraph := projectionTestReference(target.ID)
			quote.AppendChild(paragraph)
			source.Root.AppendChild(quote)
			source.Root.AppendChild(projectionTestBlock(ast.NodeParagraph, "Following"))
			return []*Operation{{Action: "append", ID: quote.ID, ParentID: paragraph.ID}}
		}},
		{"append and prepend complete multi-block fragments", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			quote.AppendChild(projectionTestReference(target.ID))
			source.Root.AppendChild(quote)
			a, b := projectionTestBlock(ast.NodeParagraph, "A"), projectionTestBlock(ast.NodeParagraph, "B")
			c, d := projectionTestBlock(ast.NodeParagraph, "C"), projectionTestBlock(ast.NodeParagraph, "D")
			return []*Operation{{Action: "appendInsert", ParentID: quote.ID, Data: projectionTestDOM(a) + projectionTestDOM(b)},
				{Action: "prependInsert", ParentID: quote.ID, Data: projectionTestDOM(c) + projectionTestDOM(d)}}
		}},
		{"append insertion follows unfolded heading section", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			heading := projectionTestBlock(ast.NodeHeading, "Heading")
			source.Root.AppendChild(heading)
			source.Root.AppendChild(projectionTestReference(target.ID))
			a, b := projectionTestBlock(ast.NodeParagraph, "A"), projectionTestBlock(ast.NodeParagraph, "B")
			return []*Operation{{Action: "appendInsert", ParentID: heading.ID, Data: projectionTestDOM(a) + projectionTestDOM(b)}}
		}},
		{"attribute normalization affects rule conditions", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			return []*Operation{{Action: "setAttrs", ID: source.ID, Data: `{"tags":"todo, todo , other","custom-state":" ready "}`},
				{Action: "setAttrs", ID: source.ID, Data: `{"tags":"other","CUSTOM-state":""}`}}
		}},
		{"list-item update resolves its rendered list wrapper", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			list, item := projectionTestList(projectionTestReference(target.ID))
			source.Root.AppendChild(list)
			replacement := cloneBlockSwapNode(list)
			replacement.FirstChild.FirstChild.LastChild.Unlink()
			return []*Operation{{Action: "update", ID: item.ID, Data: projectionTestDOM(replacement)}}
		}},
		{"insert list wrapper into an existing list", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			list, item := projectionTestList(projectionTestReference(target.ID))
			source.Root.AppendChild(list)
			fragment, newItem := projectionTestList(projectionTestBlock(ast.NodeParagraph, "Inserted"))
			return []*Operation{{Action: "insert", ID: newItem.ID, ParentID: list.ID,
				PreviousID: item.ID, Data: projectionTestDOM(fragment)}}
		}},
		{"move unique list item removes its empty source list", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			list, item := projectionTestList(projectionTestReference(target.ID))
			destination, _ := projectionTestList(projectionTestBlock(ast.NodeParagraph, "Existing"))
			source.Root.AppendChild(list)
			target.Root.AppendChild(destination)
			return []*Operation{{Action: "move", ID: item.ID, ParentID: destination.ID}}
		}},
		{"append and prepend unwrap list fragments", func(f *fileOperationTestFixture, source, target *parse.Tree) []*Operation {
			list, _ := projectionTestList(projectionTestReference(target.ID))
			source.Root.AppendChild(list)
			appendList, _ := projectionTestList(projectionTestBlock(ast.NodeParagraph, "Append"))
			prependList, _ := projectionTestList(projectionTestBlock(ast.NodeParagraph, "Prepend"))
			return []*Operation{{Action: "appendInsert", ParentID: list.ID, Data: projectionTestDOM(appendList)},
				{Action: "prependInsert", ParentID: list.ID, Data: projectionTestDOM(prependList)}}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			view.Automations = nil
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			target, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			operations := test.build(fixture, source, target)
			for _, tree := range []*parse.Tree{source, target} {
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
			}
			input, err := json.Marshal(operations)
			if err != nil {
				t.Fatal(err)
			}
			projection, err := newCollectionRemovalProjection(operations)
			if err != nil {
				t.Fatal(err)
			}
			defer projection.close()
			unchanged, _ := json.Marshal(operations)
			if !bytes.Equal(input, unchanged) {
				t.Fatal("projection mutated its operations")
			}
			for id, tree := range projection.before {
				data, readErr := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
				if readErr != nil || !bytes.Equal(data, projection.sources[id]) {
					t.Fatal("projection changed persisted source", readErr)
				}
				current, _, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
				if readErr != nil || blockSwapFingerprint(tree.Root) != blockSwapFingerprint(current.Root) {
					t.Fatal("projection changed its before tree", readErr)
				}
			}
			if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: cloneOperations(operations)}); err != nil {
				t.Fatal(err)
			}
			for _, expected := range projection.after {
				actual, _, readErr := filesys.LoadTreeSnapshot(expected.Box, expected.Path, util.NewLute())
				if readErr != nil {
					t.Fatal(readErr)
				}
				if got, want := blockSwapFingerprint(actual.Root), blockSwapFingerprint(expected.Root); got != want {
					t.Fatalf("projection disagreed with committed tree\nactual: %s\nprojected: %s", got, want)
				}
			}
		})
	}
}

func TestCollectionRemovalProjectionRejectsWriteIdentityConflicts(t *testing.T) {
	for _, action := range []string{"insert", "appendInsert", "prependInsert", "update"} {
		for _, mode := range []string{"invalidRoot", "invalidChild", "duplicateChildren", "unloadedDocument", "documentRoot"} {
			t.Run(action+"/"+mode, func(t *testing.T) {
				fixture, _, _ := setupBlockCollectionTest(t)
				source, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				target, err := LoadTreeByBlockID(fixture.targetID)
				if err != nil {
					t.Fatal(err)
				}
				quote := projectionTestBlock(ast.NodeBlockquote, "")
				if action == "update" {
					quote.ID = fixture.childID
					quote.SetIALAttr("id", quote.ID)
				}
				child := projectionTestBlock(ast.NodeParagraph, "Candidate")
				quote.AppendChild(child)
				want := "block ID already exists"
				switch mode {
				case "invalidRoot":
					quote.ID = "short"
					quote.SetIALAttr("id", quote.ID)
					want = "invalid block ID"
				case "invalidChild":
					child.ID = "short"
					child.SetIALAttr("id", child.ID)
					want = "invalid block ID"
				case "duplicateChildren":
					quote.AppendChild(cloneBlockSwapNode(child))
					want = "duplicate block ID"
				case "unloadedDocument":
					child.ID = target.Root.FirstChild.ID
					child.SetIALAttr("id", child.ID)
				case "documentRoot":
					child.ID = fixture.sourceID
					child.SetIALAttr("id", child.ID)
				}
				operation := &Operation{Action: action, ID: quote.ID, ParentID: fixture.sourceID, Data: projectionTestDOM(quote)}
				if action == "update" {
					operation.ID = fixture.childID
				}
				operations := []*Operation{operation}
				input, err := json.Marshal(operations)
				if err != nil {
					t.Fatal(err)
				}
				files := map[string][]byte{}
				for _, tree := range []*parse.Tree{source, target} {
					filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
					files[filename], err = os.ReadFile(filename)
					if err != nil {
						t.Fatal(err)
					}
				}
				version := cache.TreeDataReadVersion()
				projection, err := newCollectionRemovalProjection(operations)
				if projection != nil {
					defer projection.close()
					if projection.after[target.ID] != nil {
						t.Fatal("identity validation loaded the conflicting document into the projection")
					}
				}
				if err == nil || !strings.Contains(err.Error(), want) {
					t.Fatalf("projection accepted conflicting identities or returned the wrong error: %v", err)
				}
				unchanged, err := json.Marshal(operations)
				if err != nil || !bytes.Equal(input, unchanged) || cache.TreeDataReadVersion() != version {
					t.Fatal("rejected projection changed its input operations or tree cache", err)
				}
				assertFiles := func() {
					t.Helper()
					for filename, before := range files {
						after, readErr := os.ReadFile(filename)
						if readErr != nil || !bytes.Equal(before, after) {
							t.Fatal("rejected identity write changed source bytes", readErr)
						}
					}
				}
				assertFiles()
				if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: cloneOperations(operations)}); err == nil ||
					!strings.Contains(err.Error(), want) {
					t.Fatalf("real transaction disagreed with the rejected projection: %v", err)
				}
				assertFiles()
			})
		}
	}
}

func TestCollectionRemovalProjectionAllocatesMissingWriteIdentities(t *testing.T) {
	for _, action := range []string{"insert", "appendInsert", "prependInsert", "update"} {
		t.Run(action, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			view.Automations = nil
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			quote.AppendChild(projectionTestBlock(ast.NodeParagraph, "Retained"))
			source.Root.AppendChild(quote)
			if _, err = filesys.WriteTree(source); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(source)
			originalIDs := map[string]bool{}
			for _, id := range source.Root.BlockIDs() {
				originalIDs[id] = true
			}
			newChild := `<div data-type="NodeParagraph"><div contenteditable="true">Allocated child</div></div>`
			data := `<div data-type="NodeBlockquote">` + newChild + `</div>`
			operation := &Operation{Action: action, ParentID: source.ID, Data: data}
			if action == "update" {
				operation.ID = quote.ID
				operation.Data = `<div data-type="NodeBlockquote" data-node-id="` + quote.ID + `">` +
					projectionTestDOM(quote.FirstChild.Next) + newChild + `</div>`
			}
			operations := []*Operation{operation}
			input, err := json.Marshal(operations)
			if err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, source.Box, source.Path)
			before, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			version := cache.TreeDataReadVersion()
			projection, err := newCollectionRemovalProjection(operations)
			if err != nil {
				t.Fatal(err)
			}
			defer projection.close()
			unchanged, err := json.Marshal(operations)
			if err != nil || !bytes.Equal(input, unchanged) || cache.TreeDataReadVersion() != version {
				t.Fatal("identity allocation changed its input operations or tree cache", err)
			}
			after, err := os.ReadFile(filename)
			if err != nil || !bytes.Equal(before, after) ||
				blockSwapFingerprint(projection.before[source.ID].Root) != blockSwapFingerprint(source.Root) {
				t.Fatal("identity allocation changed the persisted or before tree", err)
			}
			normalize := func(root *ast.Node) (string, int) {
				t.Helper()
				copy := cloneBlockSwapNode(root)
				seen := map[string]bool{}
				generated := 0
				ast.Walk(copy, func(node *ast.Node, entering bool) ast.WalkStatus {
					if !entering || !node.IsBlock() || node.Type == ast.NodeKramdownBlockIAL {
						return ast.WalkContinue
					}
					if !ast.IsNodeIDPattern(node.ID) || seen[node.ID] {
						t.Fatalf("invalid or duplicate allocated identity [%s]", node.ID)
					}
					seen[node.ID] = true
					if !originalIDs[node.ID] && node.Type != ast.NodeDocument {
						generated++
						node.ID = fmt.Sprintf("20261106000000-gen%04d", generated)
						node.SetIALAttr("id", node.ID)
					}
					return ast.WalkContinue
				})
				return blockSwapFingerprint(copy), generated
			}
			want, generated := normalize(projection.after[source.ID].Root)
			wantCount := 2
			if action == "update" {
				wantCount = 1
			}
			if generated != wantCount {
				t.Fatalf("allocated %d identities, want %d", generated, wantCount)
			}
			if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: cloneOperations(operations)}); err != nil {
				t.Fatal(err)
			}
			actual, _, err := filesys.LoadTreeSnapshot(source.Box, source.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if got, count := normalize(actual.Root); got != want || count != generated {
				t.Fatalf("allocation disagreed with the committed tree\nactual: %s\nprojected: %s", got, want)
			}
		})
	}
}

func TestCollectionRemovalProjectionEmptySourceBeforeCommit(t *testing.T) {
	fixture, _, _, _ := setupAttributeViewItemsTest(t, false)
	operations := []*Operation{{Action: "append", ID: fixture.childID, ParentID: fixture.targetID}}
	projection, err := newCollectionRemovalProjection(operations)
	if err != nil {
		t.Fatal(err)
	}
	defer projection.close()
	if projection.after[fixture.sourceID].Root.FirstChild != nil {
		t.Fatal("projection added a paragraph before cleanup")
	}
	tx := &Transaction{fromAPI: true, DoOperations: cloneOperations(operations)}
	sourceWasEmpty := false
	tx.writeTransactionTree = func(tree *parse.Tree) error {
		if tree.ID == fixture.sourceID {
			// cleanup 和自动收集已执行完，prepareWriteTree 尚未补入空段。
			sourceWasEmpty = tree.Root.FirstChild == nil
		}
		return writeTreeUpsertQueueWithPreflight(tree, tx.treeIndexChanges(tree), nil)
	}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if !sourceWasEmpty {
		t.Fatal("source acquired content before its commit writer")
	}
	expected := projection.after[fixture.sourceID]
	actual, _, err := filesys.LoadTreeSnapshot(expected.Box, expected.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	placeholder := actual.Root.FirstChild
	if placeholder == nil || placeholder.Type != ast.NodeParagraph || placeholder.Next != nil ||
		placeholder.FirstChild != nil || len(placeholder.Tokens) != 0 || placeholder.IALAttr("tags") != "" {
		t.Fatal("commit did not add exactly one empty paragraph")
	}
	if projection.nodes[placeholder.ID] != nil {
		t.Fatal("commit placeholder reused a preview identity")
	}
}

func TestCollectionRemovalProjectionRejectsUnsupportedAndDeletedNodes(t *testing.T) {
	for _, action := range []string{"swapBlockRef", "convertList", "moveOutlineHeading", "setDocTitle", "create", "unknown"} {
		projection, err := newCollectionRemovalProjection([]*Operation{{Action: action}})
		if err == nil || !strings.Contains(err.Error(), "unsupported") {
			t.Fatalf("action %s was silently ignored: %v", action, err)
		}
		projection.close()
	}
	if _, err := newCollectionRemovalProjection([]*Operation{nil}); err == nil {
		t.Fatal("nil operation accepted")
	}
	fixture, _, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, fixture.childID)
	_, err = newCollectionRemovalProjection([]*Operation{{Action: "delete", ID: node.ID},
		{Action: "update", ID: node.ID, Data: projectionTestDOM(node)}})
	if err == nil {
		t.Fatal("deleted block was reloaded from persistent index")
	}
	if _, err = newCollectionRemovalProjection([]*Operation{{Action: "move", ID: fixture.childID, ParentID: fixture.childID}}); err == nil {
		t.Fatal("self move accepted")
	}
	if _, err = newCollectionRemovalProjection([]*Operation{{Action: "insert", ID: ast.NewNodeID(), PreviousID: fixture.childID,
		ParentID: fixture.targetID, Data: projectionTestDOM(projectionTestBlock(ast.NodeParagraph, "Conflicting anchors"))}}); err == nil {
		t.Fatal("ambiguous cross-document insertion anchors accepted")
	}
}

func TestCollectionRemovalProjectionEncryptedSnapshotAndLease(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{0x73}, 32)
	prepareUnlockedEncryptedBoxTest(t, fixture.box.ID, key)
	encryptDocumentTestSources(t, key, tree)
	filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	operations := []*Operation{{Action: "setAttrs", ID: tree.ID, Data: `{"custom-state":"ready"}`}}
	projection, err := newCollectionRemovalProjection(operations)
	if err != nil {
		t.Fatal(err)
	}
	defer projection.close()
	if !projection.leases[tree.Box] || !util.IsCiphertext(projection.sources[tree.ID]) ||
		!bytes.Equal(projection.sources[tree.ID], original) {
		t.Fatal("encrypted snapshot lost its operation lease or native source")
	}
	if projection.before[tree.ID].Root.IALAttr("custom-state") != "" || projection.after[tree.ID].Root.IALAttr("custom-state") != "ready" {
		t.Fatal("encrypted projection modified its before snapshot")
	}
	projection.close()
	projection.close()
	lifecycle := getEncryptedBoxLifecycle(tree.Box)
	active := func() int {
		lifecycle.lock.Lock()
		defer lifecycle.lock.Unlock()
		return lifecycle.activeOperations
	}
	if len(projection.leases) != 0 || active() != 0 {
		t.Fatal("projection did not release its operation lease")
	}
	if _, err = newCollectionRemovalProjection([]*Operation{{Action: "update", ID: fixture.childID, Data: 123}}); err == nil || active() != 0 {
		t.Fatal("failed projection retained its operation lease", err)
	}
	corrupt := bytes.Clone(original)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(filename, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = newCollectionRemovalProjection(operations); err == nil || active() != 0 {
		t.Fatal("projection accepted corrupt ciphertext or retained a lease", err)
	}
	current, _ := os.ReadFile(filename)
	if !bytes.Equal(current, corrupt) {
		t.Fatal("failed projection modified corrupt source")
	}
	if err = os.WriteFile(filename, original, 0600); err != nil {
		t.Fatal(err)
	}
	setEncryptedBoxStateWithAdmission(tree.Box, EncryptedBoxStateUnlocked, false)
	if _, err = newCollectionRemovalProjection(operations); err == nil || active() != 0 {
		t.Fatal("projection bypassed closed operation admission", err)
	}
	setEncryptedBoxState(tree.Box, EncryptedBoxStateUnlocked)
}

func TestCollectionRemovalProjectionRichSourcesAreIndependent(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	title := &ast.Node{Type: ast.NodeParagraph}
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "Rich title"})
	if err = treenode.SetDocumentTitleParagraph(tree.Root, title); err != nil {
		t.Fatal(err)
	}
	tableTree := parse.Parse("", []byte("| Header |\n| --- |\n| Content |"), util.NewLute().ParseOptions)
	table := tableTree.Root.FirstChild
	table.ID = ast.NewNodeID()
	table.SetIALAttr("id", table.ID)
	table.SetIALAttr(treenode.TableCellRichTableAttribute, "1")
	table.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "**Rich**\n\nsecond"}
	if err = treenode.RefreshTableCellRichProjection(table); err != nil {
		t.Fatal(err)
	}
	tree.Root.AppendChild(table)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	projection, err := newCollectionRemovalProjection([]*Operation{{Action: "setAttrs", ID: tree.ID, Data: `{"custom-state":"ready"}`}})
	if err != nil {
		t.Fatal(err)
	}
	defer projection.close()
	before, after := projection.before[tree.ID], projection.after[tree.ID]
	if before.Root.DocumentTitle == nil || after.Root.DocumentTitle == nil || before.Root.DocumentTitle == after.Root.DocumentTitle {
		t.Fatal("rich title was lost or aliased between snapshots")
	}
	beforeCell := treenode.GetNodeInTree(before, table.ID).LastChild.FirstChild.TableCellRich
	afterCell := treenode.GetNodeInTree(after, table.ID).LastChild.FirstChild.TableCellRich
	if beforeCell == nil || afterCell == nil || beforeCell == afterCell || beforeCell.Content != afterCell.Content {
		t.Fatal("rich cell source was lost or aliased between snapshots")
	}
	titleSource, cellSource := before.Root.DocumentTitle.Content, beforeCell.Content
	after.Root.DocumentTitle.Content += " changed"
	afterCell.Content += " changed"
	if before.Root.DocumentTitle.Content != titleSource || beforeCell.Content != cellSource {
		t.Fatal("projected rich source mutation changed the before tree")
	}
}

func TestCollectionRemovalProjectionRejectsDatabaseHostChanges(t *testing.T) {
	for _, mode := range []string{"insert", "appendInsert", "prependInsert", "delete", "delete-reinsert", "replace", "remove", "add", "unchanged", "move", "append"} {
		t.Run(mode, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			host := projectionTestBlock(ast.NodeAttributeView, "")
			host.AttributeViewID, host.AttributeViewType = ast.NewNodeID(), "table"
			quote := projectionTestBlock(ast.NodeBlockquote, "")
			quote.AppendChild(projectionTestReference(fixture.targetID))
			if mode != "add" {
				quote.AppendChild(host)
			}
			tree.Root.AppendChild(quote)
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			var operations []*Operation
			switch mode {
			case "insert", "appendInsert", "prependInsert":
				copy := cloneBlockSwapNode(host)
				copy.ID = ast.NewNodeID()
				copy.SetIALAttr("id", copy.ID)
				operations = []*Operation{{Action: mode, ID: copy.ID, ParentID: fixture.sourceID, Data: projectionTestDOM(copy)}}
			case "delete":
				operations = []*Operation{{Action: "delete", ID: quote.ID}}
			case "delete-reinsert":
				operations = []*Operation{{Action: "delete", ID: quote.ID},
					{Action: "insert", ID: quote.ID, ParentID: fixture.sourceID, Data: projectionTestDOM(quote)}}
			case "move", "append":
				operations = []*Operation{{Action: mode, ID: host.ID, ParentID: fixture.targetID}}
			default:
				copy := cloneBlockSwapNode(quote)
				switch mode {
				case "replace":
					copy.LastChild.AttributeViewID = ast.NewNodeID()
				case "remove":
					copy.LastChild.Unlink()
				case "add":
					copy.AppendChild(host)
				}
				firstContentBlock(copy).LastChild.Unlink()
				operations = []*Operation{{Action: "update", ID: quote.ID, Data: projectionTestDOM(copy)}}
			}
			projection, err := newCollectionRemovalProjection(operations)
			if projection != nil {
				defer projection.close()
			}
			if mode == "unchanged" || mode == "move" || mode == "append" {
				if err != nil {
					t.Fatal("unchanged or moved database host was rejected", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), "unsupported") {
				t.Fatal("database host side effects were silently projected", err)
			}
		})
	}
}
