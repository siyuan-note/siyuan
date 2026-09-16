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
	"slices"
	"testing"

	"github.com/88250/lute/ast"
)

func TestUndoLogClearAttributeView(t *testing.T) {
	avID := "affected-database"
	snapshot := &attributeViewFieldsSnapshot{changes: map[string]*attributeViewFieldChange{avID: {}}}
	for _, operation := range []*Operation{
		{Action: "updateAttrViewCell", AvID: avID},
		{Action: "addAttrViewCol", AvID: "related-database", attributeViewFields: snapshot},
		{Action: "insertAttrViewBlock", AvID: "related-database", attributeViewItems: &attributeViewItemsSnapshot{relatedChanges: snapshot}},
	} {
		t.Run(operation.Action, func(t *testing.T) {
			log := newUndoLog(64)
			affected := &UndoEntry{undoOperations: []*Operation{operation}}
			kept := &UndoEntry{doOperations: []*Operation{{Action: "updateAttrViewCell", AvID: "unrelated-database"}}}
			for _, rootID := range []string{"database-document", "bound-document"} {
				log.stacks[rootID] = &undoStack{
					undoStack: []*UndoEntry{kept, affected},
					redoStack: []*UndoEntry{affected, kept},
					hasUndo:   true,
				}
			}
			log.ClearAttributeView(avID)
			for _, stack := range log.stacks {
				if !slices.Equal(stack.undoStack, []*UndoEntry{kept}) || !slices.Equal(stack.redoStack, []*UndoEntry{kept}) {
					t.Fatal("database history was not removed consistently across document stacks")
				}
				if !stack.hasUndo {
					t.Fatal("clearing history changed the redo invalidation state")
				}
			}
		})
	}
}

func TestReplaceReplayOperationID(t *testing.T) {
	replacements := map[string]string{"old": "new"}
	tests := []struct {
		action string
		want   string
	}{
		{action: "insert", want: "new"},
		{action: "update", want: "new"},
		{action: "delete", want: "old"},
		{action: "move", want: "old"},
	}

	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			operation := &Operation{Action: test.action, ID: "old"}
			if !replaceReplayOperationID(operation, replacements) {
				t.Fatal("expected replacement to be detected")
			}
			if operation.ID != test.want {
				t.Fatalf("expected operation ID %q, got %q", test.want, operation.ID)
			}
		})
	}
}

func TestCloneOperationsCopiesMoveMetadata(t *testing.T) {
	original := &Operation{
		Action:   "move",
		ID:       "heading",
		BlockIDs: []string{"child"},
		Context:  map[string]any{moveGroupIDContextKey: "group"},
	}
	cloned := cloneOperations([]*Operation{original})[0]
	cloned.BlockIDs[0] = "changed"
	cloned.Context[moveGroupIDContextKey] = "changed"

	if "child" != original.BlockIDs[0] {
		t.Fatal("cloning operations should isolate move block IDs")
	}
	if "group" != original.Context[moveGroupIDContextKey] {
		t.Fatal("cloning operations should isolate move context")
	}
}

func TestReplayOperationBlockIndexes(t *testing.T) {
	containerID := "20260803120000-contain"
	childID := "20260803120001-childid"
	operations := []*Operation{
		{Action: "delete", ID: childID},
		{Action: "insert", ID: containerID, Data: `<div data-node-id="` + containerID + `"><div data-node-id="` + childID + `"></div></div>`},
	}

	insertIndexes, deleteIndexes := replayOperationBlockIndexes(operations)
	if 1 != insertIndexes[containerID] || 1 != insertIndexes[childID] {
		t.Fatalf("unexpected insert indexes: %#v", insertIndexes)
	}
	if 0 != deleteIndexes[childID] {
		t.Fatalf("unexpected delete indexes: %#v", deleteIndexes)
	}
}

func TestReplayBlockIDConflicts(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "20260803120000-documen"}
	container := &ast.Node{Type: ast.NodeBlockquote, ID: "20260803120001-contain"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "20260803120002-childid"}
	document.AppendChild(container)
	container.AppendChild(child)

	tests := []struct {
		name          string
		insertIndex   int
		deleteIndexes map[string]int
		want          bool
	}{
		{name: "real duplicate", insertIndex: 1, deleteIndexes: map[string]int{}, want: true},
		{name: "direct preceding delete", insertIndex: 1, deleteIndexes: map[string]int{child.ID: 0}, want: false},
		{name: "ancestor preceding delete", insertIndex: 1, deleteIndexes: map[string]int{container.ID: 0}, want: false},
		{name: "later delete", insertIndex: 1, deleteIndexes: map[string]int{container.ID: 2}, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := replayBlockIDConflicts(child, test.insertIndex, test.deleteIndexes); test.want != got {
				t.Fatalf("unexpected conflict result: got %v, want %v", got, test.want)
			}
		})
	}
}
