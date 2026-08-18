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
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIEditorActionsCRUD(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	actions, err := GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 0 {
		t.Fatalf("unexpected initial actions: %#v", actions)
	}

	actionText := "First line\n\"quoted\" & <tag>\nLast line"
	saved, err := SaveAIEditorAction(&AIEditorAction{Name: "Format", Action: actionText})
	if err != nil {
		t.Fatal(err)
	}
	if !ast.IsNodeIDPattern(saved.ID) {
		t.Fatalf("invalid generated action ID: %q", saved.ID)
	}

	actions, err = GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].ID != saved.ID || actions[0].Action != actionText {
		t.Fatalf("saved action changed: %#v", actions)
	}

	updatedText := "Updated\n\nAction"
	updated, err := SaveAIEditorAction(&AIEditorAction{ID: saved.ID, Name: "Updated", Action: updatedText})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != saved.ID || updated.Action != updatedText {
		t.Fatalf("unexpected updated action: %#v", updated)
	}

	nameOnly, err := SaveAIEditorAction(&AIEditorAction{Name: "Name only"})
	if err != nil {
		t.Fatal(err)
	}
	actions, err = GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 2 || actions[0].ID != saved.ID || actions[1].ID != nameOnly.ID {
		t.Fatalf("action order changed: %#v", actions)
	}

	if err = RemoveAIEditorAction(saved.ID); err != nil {
		t.Fatal(err)
	}
	if err = RemoveAIEditorAction(saved.ID); err != nil {
		t.Fatal(err)
	}
	actions, err = GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].ID != nameOnly.ID {
		t.Fatalf("unexpected actions after removal: %#v", actions)
	}
}

func TestMigrateLegacyAIEditorActions(t *testing.T) {
	tests := []struct {
		name       string
		legacyData any
	}{
		{
			name: "array",
			legacyData: []any{
				map[string]any{"name": "Existing", "memo": "Existing action"},
				map[string]any{"name": "Migrated", "memo": "Line 1\nLine 2"},
			},
		},
		{
			name:       "JSON string",
			legacyData: `[{"name":"Migrated","memo":"Line 1\nLine 2"}]`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			oldDataDir := util.DataDir
			util.DataDir = t.TempDir()
			defer func() {
				util.DataDir = oldDataDir
			}()

			if test.name == "array" {
				if _, err := SaveAIEditorAction(&AIEditorAction{Name: "Existing", Action: "Existing action"}); err != nil {
					t.Fatal(err)
				}
			}
			if err := SetLocalStorage(map[string]any{legacyAIEditorActionsStorageKey: test.legacyData}); err != nil {
				t.Fatal(err)
			}

			actions, err := GetAIEditorActions()
			if err != nil {
				t.Fatal(err)
			}
			wantCount := 1
			if test.name == "array" {
				wantCount = 2
			}
			if len(actions) != wantCount {
				t.Fatalf("unexpected migrated actions: %#v", actions)
			}
			migrated := actions[len(actions)-1]
			if migrated.Name != "Migrated" || migrated.Action != "Line 1\nLine 2" {
				t.Fatalf("legacy action changed during migration: %#v", migrated)
			}
			if _, ok := GetLocalStorage()[legacyAIEditorActionsStorageKey]; ok {
				t.Fatal("legacy AI editor actions were not removed")
			}
		})
	}
}

func TestAIEditorActionsInvalidDataIsNotOverwritten(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "invalid JSON", data: []byte(`{"version":`)},
		{name: "future version", data: []byte(`{"version":2,"actions":[]}`)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			oldDataDir := util.DataDir
			util.DataDir = t.TempDir()
			defer func() {
				util.DataDir = oldDataDir
			}()

			dataPath := aiEditorActionsPath()
			if err := os.MkdirAll(filepath.Dir(dataPath), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dataPath, test.data, 0644); err != nil {
				t.Fatal(err)
			}

			if _, err := GetAIEditorActions(); err == nil {
				t.Fatal("expected invalid data error")
			}
			if _, err := SaveAIEditorAction(&AIEditorAction{Name: "Must not be saved"}); err == nil {
				t.Fatal("expected save to reject invalid data")
			}
			current, err := os.ReadFile(dataPath)
			if err != nil {
				t.Fatal(err)
			}
			if string(current) != string(test.data) {
				t.Fatalf("invalid data was overwritten: %s", current)
			}
		})
	}
}

func TestAIEditorActionsInvalidLegacyDataIsRetained(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	if err := SetLocalStorage(map[string]any{legacyAIEditorActionsStorageKey: "{"}); err != nil {
		t.Fatal(err)
	}
	if _, err := GetAIEditorActions(); err == nil {
		t.Fatal("expected invalid legacy data error")
	}
	if _, ok := GetLocalStorage()[legacyAIEditorActionsStorageKey]; !ok {
		t.Fatal("invalid legacy AI editor actions were removed")
	}
}

func TestAIEditorActionsReadOnlyMigration(t *testing.T) {
	oldDataDir, oldReadOnly := util.DataDir, util.ReadOnly
	util.DataDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() {
		util.DataDir, util.ReadOnly = oldDataDir, oldReadOnly
	})

	if err := SetLocalStorage(map[string]any{
		legacyAIEditorActionsStorageKey: []any{
			map[string]any{"name": "Read only", "memo": "Legacy action"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	actions, err := GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].Name != "Read only" {
		t.Fatalf("legacy action is unavailable in read-only mode: %#v", actions)
	}
	if _, err = os.Stat(aiEditorActionsPath()); !os.IsNotExist(err) {
		t.Fatalf("read-only migration wrote the synchronized file: %v", err)
	}
	if _, ok := GetLocalStorage()[legacyAIEditorActionsStorageKey]; !ok {
		t.Fatal("read-only migration removed legacy AI editor actions")
	}
}
