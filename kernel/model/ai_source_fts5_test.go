// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAISourcePersistsThroughNativeArchive(t *testing.T) {
	sourceBox, targetBox, id := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	setupExportRelatedTest(t, sourceBox, targetBox)
	setupAutomationNotificationLanguage(t)
	setupNotebookDocumentImportDatabase(t)
	Conf.Editor.Store(conf.NewEditor())

	tree := treenode.NewTree(sourceBox, "/"+id+".sy", "/Provenance", "Provenance")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Original")})
	writeExportRelatedTestTree(t, tree)

	engine := util.NewLute()
	agentDOM := AgentBlockDOM(engine.Md2BlockDOM("Agent draft", true))
	editorDOM := engine.Md2BlockDOM(`Editor draft
{: custom-sy-ai-source="editor"}`, true)
	if _, err := PerformBlockOperation(&Operation{Action: "appendInsert", ParentID: id, Data: agentDOM + editorDOM}); err != nil {
		t.Fatal(err)
	}

	assertSources := func(tree *parse.Tree) {
		t.Helper()
		want := map[string]string{"Original": "", "Agent draft": "agent", "Editor draft": "editor"}
		for node := tree.Root.FirstChild; node != nil; node = node.Next {
			if node.Type != ast.NodeParagraph {
				continue
			}
			text := treenode.ExportNodeStdMd(node, engine)
			if source, ok := want[text]; !ok || node.IALAttr(nodeAttrAISource) != source {
				t.Fatalf("unexpected content or provenance: %q %q", text, node.IALAttr(nodeAttrAISource))
			}
			delete(want, text)
		}
		if len(want) != 0 {
			t.Fatalf("missing blocks: %v", want)
		}
	}
	reopened, err := filesys.LoadTree(sourceBox, tree.Path, engine)
	if err != nil {
		t.Fatal(err)
	}
	assertSources(reopened)

	exportPath := ExportSYs([]string{id})
	archive := openExportArchive(t, exportPath)
	data := readArchiveFile(t, archive, "Provenance/"+id+".sy")
	if strings.Count(data, `"custom-sy-ai-source":`) != 2 {
		t.Fatalf("unexpected provenance properties in archive: %s", data)
	}
	absolutePath, err := exportedFilePath(exportPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = ImportSY(absolutePath, targetBox, "/"); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob(filepath.Join(util.DataDir, targetBox, "*.sy"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected one imported document, got %v: %v", matches, err)
	}
	imported, err := filesys.LoadTree(targetBox, "/"+filepath.Base(matches[0]), engine)
	if err != nil {
		t.Fatal(err)
	}
	assertSources(imported)
}
