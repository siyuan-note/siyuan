// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockReadDescriptionsDistinguishContentFromPreviews(t *testing.T) {
	for _, instruction := range []string{
		"anchor text is only a preview",
		"at most 5120 characters per Content/Markdown field",
		"document root returns its title, not its body",
		"get_kramdown for complete block or document-body Markdown",
		"previews truncated to 200 characters",
		"batch_get returns only metadata",
		"Use batch_kramdown for multiple content reads",
		"Before update, read the current ordinary block",
		"complete replacement, not a delta",
		"lockType protects the block type, not its content",
	} {
		if !strings.Contains(BlockTool.Description, instruction) {
			t.Errorf("missing block reading instruction %q", instruction)
		}
	}
	if !strings.Contains(BlockTool.InputSchema.Properties["data"].Description, "complete replacement after reading current content") {
		t.Fatal("update data must explain read-before-replace semantics")
	}
	if !strings.Contains(SQLTool.Description, "Never switch to SQL to bypass block-tool notebook scope, ambiguity or access errors") ||
		!strings.Contains(SQLTool.InputSchema.Properties["notebook"].Description, "required for encrypted queries") {
		t.Fatal("SQL must distinguish structural queries from scoped block reads")
	}
}

func TestBlockReadsDistinguishTitlesPreviewsAndDocumentBody(t *testing.T) {
	previousData, previousDB, previousConf := util.DataDir, util.BlockTreeDBPath, model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		cache.ClearTreeCache()
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf = previousData, previousDB, previousConf
		if previousDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	boxID, rootID := ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Document title", "Document title")
	paragraph := tree.Root.FirstChild
	body := strings.Repeat("paragraph content ", 400) + "complete body tail"
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(body)})
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	for _, read := range []func(map[string]any) (CallToolResult, error){blockGet, documentGet} {
		result, err := read(map[string]any{"id": rootID})
		if err != nil || result.IsError {
			t.Fatalf("read document metadata: %+v, %v", result, err)
		}
		text := probeText(result)
		if !strings.Contains(text, "Content: Document title") || strings.Contains(text, "paragraph content") || strings.Contains(text, "complete body tail") {
			t.Fatalf("document metadata must contain the title, not its body: %s", text)
		}
	}
	preview, err := blockGetChildren(map[string]any{"id": rootID})
	if err != nil || preview.IsError || !strings.Contains(probeText(preview), paragraph.ID) || !strings.Contains(probeText(preview), "...") || strings.Contains(probeText(preview), "complete body tail") {
		t.Fatalf("child listing must return a truncated preview with its ID: %+v, %v", preview, err)
	}
	block, err := blockGet(map[string]any{"id": paragraph.ID})
	if err != nil || block.IsError || !strings.Contains(probeText(block), body[:5120]+"...") || strings.Contains(probeText(block), "complete body tail") {
		t.Fatalf("block.get must expose its bounded content rather than the full long block: %+v, %v", block, err)
	}
	for _, read := range []struct {
		name string
		call func(map[string]any) (CallToolResult, error)
		id   string
	}{
		{"block_kramdown", blockGetKramdown, paragraph.ID},
		{"document_kramdown", blockGetKramdown, rootID},
	} {
		t.Run(read.name, func(t *testing.T) {
			result, err := read.call(map[string]any{"id": read.id})
			if err != nil || result.IsError || !strings.Contains(probeText(result), body) {
				t.Fatalf("full content read must include the truncated tail: %+v, %v", result, err)
			}
		})
	}
}
