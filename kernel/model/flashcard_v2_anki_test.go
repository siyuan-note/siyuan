// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnkiMediaUsesGlobalAssets(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	writer := &flashcardV2AnkiContentWriter{notebookID: "20260812000003-ankibox"}
	assetPath, err := writer.StoreMedia(context.Background(), "Image.PNG", []byte("image data"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(assetPath, "?box=") {
		t.Fatalf("ordinary Anki media path contains notebook query: %q", assetPath)
	}
	diskName := strings.TrimPrefix(assetPath, "assets/")
	if data, readErr := os.ReadFile(filepath.Join(util.DataDir, "assets", diskName)); readErr != nil {
		t.Fatal(readErr)
	} else if string(data) != "image data" {
		t.Fatalf("Anki media content = %q, want %q", data, "image data")
	}
	if _, statErr := os.Stat(filepath.Join(util.DataDir, writer.notebookID, "assets", diskName)); !os.IsNotExist(statErr) {
		t.Fatalf("Anki media unexpectedly exists in notebook assets: %v", statErr)
	}
}

func TestSafeAnkiHTMLToMarkdownRemovesExecutableContent(t *testing.T) {
	markdown, err := safeAnkiHTMLToMarkdown(`<b>Question</b><script>alert(1)</script>` +
		`<a href="javascript:alert(2)">unsafe</a><img src="assets/anki-image.png?box=box-id" onerror="alert(3)">`)
	if err != nil {
		t.Fatal(err)
	}
	for _, unsafe := range []string{"script", "javascript:", "onerror", "alert("} {
		if strings.Contains(strings.ToLower(markdown), unsafe) {
			t.Fatalf("unsafe Anki content survived conversion: %q", markdown)
		}
	}
	if !strings.Contains(markdown, "Question") || !strings.Contains(markdown, "assets/anki-image.png") {
		t.Fatalf("safe Anki content was lost: %q", markdown)
	}
}

func TestAnkiSuperBlockDOMKeepsContainerAndFieldIDs(t *testing.T) {
	const (
		containerID = "20260811000000-contain"
		fieldID     = "20260811000001-field00"
	)
	engine := util.NewLute()
	fieldDOM := ankiSuperBlockDOM(fieldID, engine.Md2BlockDOM("Answer", false), "")
	tree := engine.BlockDOM2Tree(ankiSuperBlockDOM(containerID, fieldDOM, ` custom-anki-note-id="1"`))
	container := treenode.GetNodeInTree(tree, containerID)
	field := treenode.GetNodeInTree(tree, fieldID)
	if container == nil || container.Type != ast.NodeSuperBlock || field == nil || field.Type != ast.NodeSuperBlock {
		t.Fatalf("Anki container DOM lost stable block IDs: container=%v field=%v", container, field)
	}
	if field.Parent != container {
		t.Fatal("Anki field must remain inside its note container")
	}
}

func TestAnkiDescendantRejectsSiblingContainer(t *testing.T) {
	const (
		firstContainerID  = "20260811000000-contain"
		secondContainerID = "20260811000001-contain"
		fieldID           = "20260811000002-field00"
	)
	engine := util.NewLute()
	tree := engine.BlockDOM2Tree(ankiSuperBlockDOM(firstContainerID,
		ankiSuperBlockDOM(fieldID, engine.Md2BlockDOM("Answer", false), ""), "") +
		ankiSuperBlockDOM(secondContainerID, engine.Md2BlockDOM("Other", false), ""))
	first := treenode.GetNodeInTree(tree, firstContainerID)
	second := treenode.GetNodeInTree(tree, secondContainerID)
	field := treenode.GetNodeInTree(tree, fieldID)
	if !isAnkiDescendant(field, first) {
		t.Fatal("Anki field should be recognized inside its container")
	}
	if isAnkiDescendant(field, second) {
		t.Fatal("Anki field must not be recovered from a sibling container")
	}
}
