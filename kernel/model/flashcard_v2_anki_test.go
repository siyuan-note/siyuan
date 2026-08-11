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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
