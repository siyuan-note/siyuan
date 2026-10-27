// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockDeleteRejectsDocument(t *testing.T) {
	previousData, previousDB, previousConf := util.DataDir, util.BlockTreeDBPath, model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		cache.ClearTreeCache()
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf = previousData, previousDB, previousConf
		if previousDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	boxID, rootID, avID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Document", "Document")
	tree.Root.FirstChild.SetIALAttr(av.NodeAttrNameAvs, avID)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	docPath := filepath.Join(util.DataDir, boxID, tree.Path)
	before, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	result, err := blockDelete(map[string]any{"id": rootID})
	if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, "document cannot be deleted") {
		t.Fatalf("document deletion accepted: %+v, %v", result, err)
	}
	if after, err := os.ReadFile(docPath); err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected deletion changed the document and its bindings")
	}
}

func TestBlockToolDocumentsSuperBlockSyntax(t *testing.T) {
	description := BlockTool.InputSchema.Properties["data"].Description
	for _, instruction := range []string{
		"{{{col",
		"col is horizontal and row is vertical",
		"data-sb-layout",
		"never data-layout",
		"every child needs an explicit data-type",
	} {
		if !strings.Contains(description, instruction) {
			t.Fatalf("block data description is missing the super-block instruction %q", instruction)
		}
	}
}

func TestMarkdownToBlockDOMCreatesHorizontalSuperBlock(t *testing.T) {
	description := BlockTool.InputSchema.Properties["data"].Description
	start := strings.Index(description, "{{{col\n")
	end := strings.Index(description, "\nUse {{{row")
	if start < 0 || end <= start {
		t.Fatal("missing super-block Markdown example")
	}
	dom, err := markdownToBlockDOM(description[start:end])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dom, `data-type="NodeSuperBlock"`) || !strings.Contains(dom, `data-sb-layout="col"`) {
		t.Fatalf("horizontal super-block was not preserved in block DOM: %s", dom)
	}
	if count := strings.Count(dom, `data-type="NodeParagraph"`); count != 2 {
		t.Fatalf("expected two paragraph blocks, got %d: %s", count, dom)
	}
	if strings.Contains(dom, `data-type="NodeHTMLBlock"`) {
		t.Fatalf("super-block children became HTML blocks: %s", dom)
	}
}

func TestBlockToolDocumentsPlacement(t *testing.T) {
	for _, instruction := range []string{
		"following siblings, not its children", "as previousID, never as parentID",
		"list-item must have a NodeList parent", "cannot directly contain another list-item",
		"create a NodeList inside the outer list-item",
	} {
		if !strings.Contains(BlockTool.Description, instruction) {
			t.Fatalf("missing block placement rule %q", instruction)
		}
	}
}

func TestBlockWriteSuccess(t *testing.T) {
	const id = "20260818000000-abcdefg"
	result, err := blockWriteSuccess("append", id)
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError || !result.HasStructuredContent() || len(result.Content) != 1 {
		t.Fatalf("unexpected block write result: %#v", result)
	}

	textOutput := &blockWriteOutput{}
	if err = json.Unmarshal([]byte(result.Content[0].Text), textOutput); err != nil {
		t.Fatal(err)
	}
	if textOutput.Action != "append" || textOutput.ID != id {
		t.Fatalf("unexpected text output: %#v", textOutput)
	}

	structuredOutput, ok := result.StructuredContent.(*blockWriteOutput)
	if !ok || structuredOutput.Action != "append" || structuredOutput.ID != id {
		t.Fatalf("unexpected structured output: %#v", result.StructuredContent)
	}
}

func TestBlockWriteSuccessRejectsEmptyID(t *testing.T) {
	result, err := blockWriteSuccess("insert", "")
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatalf("expected empty block ID to fail: %#v", result)
	}
}

const nativeMindmapTestDOM = `<div data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">Root</div></div><div data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">Child</div></div></div></div></div></div>`

func TestBlockToolCreatesNativeContainers(t *testing.T) {
	description := BlockTool.InputSchema.Properties["data"].Description
	tabsStart := strings.Index(description, "::: tabs\n")
	tabsEnd := strings.Index(description, "\nThe opening fence")
	if tabsStart < 0 || tabsEnd <= tabsStart {
		t.Fatal("missing native tabs Markdown example")
	}
	_, mindmap, found := strings.Cut(description, "Native Mindmap DOM (dataType=dom):\n")
	if !found {
		t.Fatal("missing native mindmap DOM example")
	}
	mindmap, _, _ = strings.Cut(mindmap, "\n")
	for _, tc := range []struct {
		name, data, dataType string
		want                 ast.NodeType
		count                int
	}{
		{"tabs", description[tabsStart:tabsEnd], "markdown", ast.NodeTabs, 5},
		{"mindmap", mindmap, "dom", ast.NodeMindmap, 6},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dom, err := prepareBlockWriteData(tc.data, tc.dataType)
			if err != nil {
				t.Fatal(err)
			}
			tree := util.NewLute().BlockDOM2Tree(dom)
			if tree.Root.FirstChild.Type != tc.want {
				t.Fatalf("expected native %s, got %s", tc.want, tree.Root.FirstChild.Type)
			}
			if err = treenode.ValidateBlockSubtree(tree.Root); err != nil {
				t.Fatal(err)
			}
			ids := map[string]bool{}
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.IsBlock() && node.Type != ast.NodeDocument && node.Type != ast.NodeKramdownBlockIAL {
					if !ast.IsNodeIDPattern(node.ID) || ids[node.ID] || node.IALAttr("updated") == "" {
						t.Fatalf("invalid or duplicate block identity: %+v", node)
					}
					ids[node.ID] = true
				}
				return ast.WalkContinue
			})
			if len(ids) != tc.count {
				t.Fatalf("expected %d independently editable blocks, got %d", tc.count, len(ids))
			}
			if tc.want == ast.NodeTabs && tree.Root.FirstChild.IALAttr("tabs-active-id") != tree.Root.FirstChild.ChildrenByType(ast.NodeTabItem)[1].ID {
				t.Fatal("active tab was not preserved")
			}
		})
	}
}

func TestBlockToolPreservesNativeDOMIdentity(t *testing.T) {
	const id = "20261007000000-para001"
	dom := strings.Replace(nativeMindmapTestDOM, `data-type="NodeParagraph"`, `data-node-id="`+id+`" updated="20261006000000" custom-test="kept" data-type="NodeParagraph"`, 1)
	prepared, err := prepareBlockWriteData(dom, "dom")
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(util.NewLute().BlockDOM2Tree(prepared), id)
	if node == nil || node.IALAttr("updated") != "20261006000000" || node.IALAttr("custom-test") != "kept" {
		t.Fatal("existing identity or attributes were changed")
	}
	if _, err = prepareBlockWriteData(strings.Replace(dom, id, "invalid", 1), "dom"); err == nil {
		t.Fatal("invalid explicit block ID was accepted")
	}
	duplicate := strings.ReplaceAll(nativeMindmapTestDOM, `data-type="NodeParagraph"`, `data-node-id="`+id+`" data-type="NodeParagraph"`)
	if _, err = prepareBlockWriteData(duplicate, "dom"); err == nil {
		t.Fatal("duplicate explicit block IDs were accepted")
	}
}

func TestBlockToolDocumentsNativeContainerEditing(t *testing.T) {
	for _, instruction := range []string{
		"NodeTabs/NodeTabItem", "NodeMindmap/NodeMindmapItem",
		"native, editable blocks", "do not substitute HTML widgets, Mermaid diagrams, or plugins unless requested",
		"NodeTabs contains only NodeTabItem", "at least one body block", "empty paragraph for an empty body",
		"NodeMindmap contains only NodeMindmapItem", "nested NodeMindmap for child branches",
		"never put a plain NodeList, NodeListItem, or a bare NodeMindmapItem directly inside an item",
		"mindmap code fence creates an ordinary code block, not a native mindmap",
		"only the group's direct items are inserted", "target container's attributes are preserved",
		"move/delete on existing item IDs", "edit body blocks individually",
		"tabs-position (top/left)", "tabs-active-id (an existing direct item ID)",
		"use dom before editing", "Never rebuild these containers from their reading Markdown",
		"Preserve all existing data-node-id values and attributes", "active tabs and mindmap metadata",
		"dataType=dom and lockType=true", "unless the user explicitly requests a type conversion",
	} {
		if !strings.Contains(BlockTool.Description, instruction) {
			t.Fatalf("missing native container instruction %q", instruction)
		}
	}
	for _, instruction := range []string{
		"never write :::tabs or :::tab", "Nested groups require longer outer colon fences",
		"Every block needs an explicit data-type", "may omit data-node-id; the tool generates IDs",
	} {
		if !strings.Contains(BlockTool.InputSchema.Properties["data"].Description, instruction) {
			t.Fatalf("missing native block data instruction %q", instruction)
		}
	}
}
