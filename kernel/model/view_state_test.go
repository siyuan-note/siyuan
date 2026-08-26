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
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPatchViewState(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const key = "backlink:dock:20260820000000-host"
	if _, err := PatchViewState(key, map[string]any{
		"document:backlink:20260820000000-document":                    true,
		"fold:backlink:20260820000000-occurrence:20260820000000-block": true,
	}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := PatchViewState(key, map[string]any{
		"anchor:backlink": map[string]any{"blockID": "20260820000000-block", "offset": 24},
	}, []string{"document:backlink:20260820000000-document"}); err != nil {
		t.Fatal(err)
	}

	state, err := GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := state["document:backlink:20260820000000-document"]; exists {
		t.Fatalf("removed view state value still exists: %#v", state)
	}
	if folded, ok := state["fold:backlink:20260820000000-occurrence:20260820000000-block"].(bool); !ok || !folded {
		t.Fatalf("fold state was not preserved: %#v", state)
	}
	if _, err = PatchViewState(key, map[string]any{
		"fold:backlink:20260820000000-occurrence:20260820000000-block": false,
	}, nil); err != nil {
		t.Fatal(err)
	}
	state, err = GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	if folded, ok := state["fold:backlink:20260820000000-occurrence:20260820000000-block"].(bool); !ok || folded {
		t.Fatalf("explicit expanded state was not preserved: %#v", state)
	}
	anchor, ok := state["anchor:backlink"].(map[string]any)
	if !ok || anchor["blockID"] != "20260820000000-block" {
		t.Fatalf("anchor state was not merged: %#v", state)
	}

	if err = RemoveViewState(key); err != nil {
		t.Fatal(err)
	}
	state, err = GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(state) {
		t.Fatalf("removed view state is not empty: %#v", state)
	}
}

func TestViewStateValidationAndPatchLimits(t *testing.T) {
	if _, err := GetViewState(" "); nil == err {
		t.Fatal("whitespace-only view state key should be rejected")
	}
	if _, err := GetViewState(strings.Repeat("k", 1025)); nil == err {
		t.Fatal("oversized view state key should be rejected")
	}
	if _, err := PatchViewState("view", map[string]any{" ": true}, nil); nil == err {
		t.Fatal("whitespace-only view state data key should be rejected")
	}
	if _, err := PatchViewState("view", map[string]any{strings.Repeat("f", 2049): true}, nil); nil == err {
		t.Fatal("oversized view state data key should be rejected")
	}

	values := map[string]any{}
	for i := 0; i <= maxViewStatePatchCount; i++ {
		values[fmt.Sprintf("field-%04d", i)] = true
	}
	if _, err := PatchViewState("view", values, nil); nil == err {
		t.Fatal("oversized view state patch entry count should be rejected")
	}
	if _, err := PatchViewState("view", map[string]any{
		"value": strings.Repeat("x", maxViewStatePatchBytes),
	}, nil); nil == err {
		t.Fatal("oversized view state patch payload should be rejected")
	}
}

func TestPatchViewStateConcurrently(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const key = "backlink:bottom:20260820000000-host"
	const count = 32
	errs := make(chan error, count)
	var waitGroup sync.WaitGroup
	for i := 0; i < count; i++ {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			_, err := PatchViewState(key, map[string]any{
				fmt.Sprintf("fold:%02d", index): 0 == index%2,
			}, nil)
			errs <- err
		}(i)
	}
	waitGroup.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	state, err := GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	if count != len(state) {
		t.Fatalf("concurrent patches overwrote values: got %d, want %d", len(state), count)
	}
}

func TestGetViewStateReturnsDeepCopy(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const key = "backlink:local:20260820000000-host"
	patched, err := PatchViewState(key, map[string]any{
		"anchor:backlink": map[string]any{
			"blockID": "20260820000000-block",
			"fallbackIDs": []any{
				"20260820000000-previous",
				"20260820000000-next",
			},
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	patchedAnchor := patched["anchor:backlink"].(map[string]any)
	patchedAnchor["blockID"] = "mutated"
	patchedAnchor["fallbackIDs"].([]any)[0] = "mutated"

	state, err := GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	anchor := state["anchor:backlink"].(map[string]any)
	if anchor["blockID"] != "20260820000000-block" ||
		anchor["fallbackIDs"].([]any)[0] != "20260820000000-previous" {
		t.Fatalf("patched view state shares nested data: %#v", state)
	}
	anchor["blockID"] = "mutated"
	anchor["fallbackIDs"].([]any)[0] = "mutated"

	state, err = GetViewState(key)
	if err != nil {
		t.Fatal(err)
	}
	anchor = state["anchor:backlink"].(map[string]any)
	if anchor["blockID"] != "20260820000000-block" ||
		anchor["fallbackIDs"].([]any)[0] != "20260820000000-previous" {
		t.Fatalf("returned view state shares nested data: %#v", state)
	}
}

func TestLoadViewStateAppliesLimits(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	views := map[string]*ViewState{}
	for i := 0; i < maxViewStateCount+2; i++ {
		views[fmt.Sprintf("view-%04d", i)] = &ViewState{
			Updated: int64(i),
			Data:    map[string]any{"value": i},
		}
	}
	latest := views[fmt.Sprintf("view-%04d", maxViewStateCount+1)]
	latest.Data = map[string]any{}
	latest.Order = []string{}
	for i := 0; i < maxViewStateDataCount+2; i++ {
		key := fmt.Sprintf("field-%05d", i)
		latest.Data[key] = i
		latest.Order = append(latest.Order, key)
	}

	storageDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(&viewStateStorage{Version: viewStateVersion, Views: views})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(storageDir, "view-state.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	loaded, err := getViewStateStorage()
	if err != nil {
		t.Fatal(err)
	}
	if maxViewStateCount != len(loaded.Views) || nil != loaded.Views["view-0000"] || nil != loaded.Views["view-0001"] {
		t.Fatalf("loaded view count was not pruned: %d", len(loaded.Views))
	}
	latest = loaded.Views[fmt.Sprintf("view-%04d", maxViewStateCount+1)]
	if nil == latest || maxViewStateDataCount != len(latest.Data) || maxViewStateDataCount != len(latest.Order) {
		t.Fatalf("loaded field count was not pruned: %#v", latest)
	}
	if _, exists := latest.Data["field-00000"]; exists {
		t.Fatal("oldest loaded field was not pruned")
	}
	if _, exists := latest.Data["field-00001"]; exists {
		t.Fatal("second oldest loaded field was not pruned")
	}
}

func TestSetViewStateStoragePrunesOldestViewBySize(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	storage := oversizedViewStateStorage()
	if err := setViewStateStorage(storage); err != nil {
		t.Fatal(err)
	}
	if nil != storage.Views["old"] || nil == storage.Views["new"] {
		t.Fatalf("storage size pruning did not evict the oldest view: %#v", storage.Views)
	}
	info, err := os.Stat(filepath.Join(util.DataDir, "storage", "view-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if maxViewStateStorageSize < info.Size() {
		t.Fatalf("view state storage exceeds the size limit: %d", info.Size())
	}
}

func TestLoadViewStateStoragePrunesOldestViewBySize(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	storageDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(oversizedViewStateStorage())
	if err != nil {
		t.Fatal(err)
	}
	if len(data) <= maxViewStateStorageSize {
		t.Fatalf("test storage does not exceed the size limit: %d", len(data))
	}
	if err = os.WriteFile(filepath.Join(storageDir, "view-state.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	loaded, err := getViewStateStorage()
	if err != nil {
		t.Fatal(err)
	}
	if nil != loaded.Views["old"] || nil == loaded.Views["new"] {
		t.Fatalf("loaded storage size pruning did not evict the oldest view: %#v", loaded.Views)
	}
}

func oversizedViewStateStorage() *viewStateStorage {
	return &viewStateStorage{Version: viewStateVersion, Views: map[string]*ViewState{
		"old": {
			Updated: 1,
			Data: map[string]any{
				"value": strings.Repeat("x", maxViewStateStorageSize),
			},
			Order: []string{"value"},
		},
		"new": {
			Updated: 2,
			Data:    map[string]any{"value": true},
			Order:   []string{"value"},
		},
	}}
}

func TestPruneViewStates(t *testing.T) {
	views := map[string]*ViewState{}
	for i := 0; i < maxViewStateCount+2; i++ {
		views[fmt.Sprintf("view-%04d", i)] = &ViewState{Updated: int64(i), Data: map[string]any{"value": i}}
	}
	pruneViewStates(views)
	if maxViewStateCount != len(views) {
		t.Fatalf("unexpected view state count: got %d, want %d", len(views), maxViewStateCount)
	}
	if nil != views["view-0000"] || nil != views["view-0001"] {
		t.Fatalf("oldest view states were not pruned")
	}
}

func TestNextViewStateUpdatedRebasesOverflow(t *testing.T) {
	views := map[string]*ViewState{
		"old":    {Updated: 10, Data: map[string]any{"value": true}},
		"future": {Updated: math.MaxInt64, Data: map[string]any{"value": true}},
	}
	updated := nextViewStateUpdated(views)
	if views["old"].Updated >= views["future"].Updated || views["future"].Updated >= updated {
		t.Fatalf("view state timestamps were not rebased in LRU order: %#v, %d", views, updated)
	}
}

func TestPruneViewStateFieldsUsesFieldOrder(t *testing.T) {
	state := &ViewState{Data: map[string]any{}, Order: []string{}}
	for i := 0; i < maxViewStateDataCount+2; i++ {
		key := fmt.Sprintf("field-%05d", i)
		state.Data[key] = i
		state.Order = append(state.Order, key)
	}
	pruneViewStateFields(state)
	if maxViewStateDataCount != len(state.Data) || maxViewStateDataCount != len(state.Order) {
		t.Fatalf("unexpected field count after pruning: %d, %d", len(state.Data), len(state.Order))
	}
	if _, exists := state.Data["field-00000"]; exists {
		t.Fatal("oldest field was not pruned")
	}
	if _, exists := state.Data["field-00001"]; exists {
		t.Fatal("second oldest field was not pruned")
	}
}

func TestViewStateIsIgnoredBySync(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	ignoreLines := getSyncIgnoreLines()
	lines := map[string]bool{}
	for _, line := range ignoreLines {
		lines[line] = true
	}
	if !lines["/storage/view-state.json"] || !lines["/storage/view-state-corrupted-*.json"] {
		t.Fatalf("view state files are not ignored by sync: %#v", lines)
	}
	matcher := ignore.CompileIgnoreLines(ignoreLines...)
	for _, path := range []string{
		"/storage/view-state.json",
		"/storage/view-state-corrupted-20260820000000.json",
	} {
		if !matcher.MatchesPath(path) {
			t.Fatalf("view state path is not ignored by sync: %s", path)
		}
	}
}

func TestCorruptedViewStateIsBackedUp(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	storageDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	dataPath := filepath.Join(storageDir, "view-state.json")
	if err := os.WriteFile(dataPath, []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}
	state, err := GetViewState("backlink:local:host")
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(state) {
		t.Fatalf("corrupted storage should recover as empty: %#v", state)
	}
	if _, err = os.Stat(dataPath); !os.IsNotExist(err) {
		t.Fatalf("corrupted storage was not moved: %v", err)
	}
	backups, err := filepath.Glob(filepath.Join(storageDir, "view-state-corrupted-*.json"))
	if err != nil || 1 != len(backups) {
		t.Fatalf("unexpected corrupted storage backups: %#v, %v", backups, err)
	}
	backupData, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatal(err)
	}
	if "{" != string(backupData) {
		t.Fatalf("corrupted storage backup was changed: %q", backupData)
	}
}

func TestFutureViewStateVersionIsNotOverwritten(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	storageDir := filepath.Join(util.DataDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	dataPath := filepath.Join(storageDir, "view-state.json")
	original := []byte(`{"version":2,"views":[{"future":"schema"}]}`)
	if err := os.WriteFile(dataPath, original, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := PatchViewState("backlink:local:host", map[string]any{"value": false}, nil); nil == err {
		t.Fatal("future view state version should be rejected")
	}
	data, err := os.ReadFile(dataPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(original) != string(data) {
		t.Fatalf("future view state storage was overwritten: %s", data)
	}
	backups, err := filepath.Glob(filepath.Join(storageDir, "view-state-corrupted-*.json"))
	if err != nil || 0 != len(backups) {
		t.Fatalf("future view state storage was treated as corrupted: %#v, %v", backups, err)
	}
}
