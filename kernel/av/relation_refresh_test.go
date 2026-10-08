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

package av

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCollectSrcAvIDsForRefresh(t *testing.T) {
	tests := []struct {
		name  string
		seeds []string
		graph map[string][]string
		want  []string
	}{
		{
			name:  "empty seeds",
			graph: map[string][]string{"A": {"B"}},
		},
		{
			name:  "three databases",
			seeds: []string{"A"},
			graph: map[string][]string{"A": {"B"}, "B": {"C"}},
			want:  []string{"B", "C"},
		},
		{
			name:  "four databases",
			seeds: []string{"A"},
			graph: map[string][]string{"A": {"B"}, "B": {"C"}, "C": {"D"}},
			want:  []string{"B", "C", "D"},
		},
		{
			name:  "diamond",
			seeds: []string{"A"},
			graph: map[string][]string{"A": {"B", "C"}, "B": {"D"}, "C": {"D"}},
			want:  []string{"B", "C", "D"},
		},
		{
			name:  "cycle with dependent",
			seeds: []string{"A"},
			graph: map[string][]string{"A": {"B"}, "B": {"C"}, "C": {"A", "D"}},
			want:  []string{"B", "C", "D"},
		},
		{
			name:  "self loops",
			seeds: []string{"A"},
			graph: map[string][]string{"A": {"A", "B"}, "B": {"B", "C"}, "C": {"C"}},
			want:  []string{"B", "C"},
		},
		{
			name:  "duplicates and multiple connected seeds",
			seeds: []string{"A", "B", "A"},
			graph: map[string][]string{"A": {"B", "B", "C"}, "B": {"D", "C"}, "C": {"D", "A"}},
			want:  []string{"C", "D"},
		},
		{
			name:  "multiple independent seeds and disconnected graph",
			seeds: []string{"A", "X"},
			graph: map[string][]string{"A": {"B"}, "B": {"C"}, "X": {"Y"}, "Y": {"Z"}, "Q": {"R"}},
			want:  []string{"B", "Y", "C", "Z"},
		},
		{
			name:  "no dependents",
			seeds: []string{"A"},
			graph: map[string][]string{"Q": {"R"}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalSeeds := append([]string(nil), test.seeds...)
			calls := map[string]int{}
			got := collectSrcAvIDsForRefresh(test.seeds, func(avID string) []string {
				calls[avID]++
				if calls[avID] != 1 {
					t.Fatalf("database %s was visited more than once", avID)
				}
				return test.graph[avID]
			})
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("unexpected dependent databases: got %v, want %v", got, test.want)
			}
			if !reflect.DeepEqual(test.seeds, originalSeeds) {
				t.Fatalf("refresh traversal changed its seeds: got %v, want %v", test.seeds, originalSeeds)
			}
			wantCalls := map[string]int{}
			for _, avID := range append(originalSeeds, test.want...) {
				wantCalls[avID] = 1
			}
			if !reflect.DeepEqual(calls, wantCalls) {
				t.Fatalf("unexpected database lookups: got %v, want %v", calls, wantCalls)
			}
		})
	}
}

func TestGetSrcAvIDsForRefreshUsesPersistedBoxRelations(t *testing.T) {
	previousDataDir := util.DataDir
	previousDEKProvider := AVDEKProvider
	previousEncryptedBoxIDs := AVEncryptedBoxIDs
	previousLockAcquire, previousLockRelease := AVLockAcquire, AVLockRelease
	util.DataDir = t.TempDir()
	AVLockAcquire, AVLockRelease = nil, nil
	t.Cleanup(func() {
		util.DataDir = previousDataDir
		AVDEKProvider = previousDEKProvider
		AVEncryptedBoxIDs = previousEncryptedBoxIDs
		AVLockAcquire, AVLockRelease = previousLockAcquire, previousLockRelease
	})

	scopes := []struct {
		name  string
		boxID string
		ids   []string
	}{
		{name: "plain", ids: []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}},
		{name: "encrypted box one", boxID: ast.NewNodeID(), ids: []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}},
		{name: "encrypted box two", boxID: ast.NewNodeID(), ids: []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}},
	}
	keys := map[string][]byte{
		scopes[1].boxID: []byte("0123456789abcdef0123456789abcdef"),
		scopes[2].boxID: []byte("abcdef0123456789abcdef0123456789"),
	}
	AVDEKProvider = func(boxID string) ([]byte, error) { return keys[boxID], nil }
	AVEncryptedBoxIDs = func() []string { return []string{scopes[1].boxID, scopes[2].boxID} }
	for _, scope := range scopes {
		for _, avID := range scope.ids {
			avPath := attributeViewDataPathByBox(avID, scope.boxID)
			if err := os.MkdirAll(filepath.Dir(avPath), 0755); nil != err {
				t.Fatalf("create database directory failed: %v", err)
			}
			data, err := encryptAVData(scope.boxID, avID, []byte("{}"))
			if nil != err {
				t.Fatalf("encrypt database fixture failed: %v", err)
			}
			if err = os.WriteFile(avPath, data, 0644); nil != err {
				t.Fatalf("write database fixture failed: %v", err)
			}
		}
	}

	for _, scope := range scopes {
		relations := map[string][]string{
			scope.ids[0]: {scope.ids[1]},
			scope.ids[1]: {scope.ids[2]},
			scope.ids[2]: {scope.ids[0]},
		}
		// 其他分箱中的同名索引项不能影响当前数据库的通知范围。
		for _, otherScope := range scopes {
			if scope.boxID == otherScope.boxID {
				continue
			}
			for _, avID := range otherScope.ids {
				relations[avID] = []string{ast.NewNodeID()}
			}
		}
		writeRelations(scope.boxID, relations)
	}

	for _, scope := range scopes {
		t.Run(scope.name, func(t *testing.T) {
			if got := GetSrcAvIDs(scope.ids[0]); !reflect.DeepEqual(got, scope.ids[1:2]) {
				t.Fatalf("direct relation lookup changed: got %v, want %v", got, scope.ids[1:2])
			}
			if got := GetSrcAvIDsForRefresh(scope.ids[:1]); !reflect.DeepEqual(got, scope.ids[1:]) {
				t.Fatalf("unexpected box-scoped dependents: got %v, want %v", got, scope.ids[1:])
			}
		})
	}

	seeds := []string{scopes[0].ids[0], scopes[1].ids[0], scopes[2].ids[0]}
	want := []string{scopes[0].ids[1], scopes[1].ids[1], scopes[2].ids[1], scopes[0].ids[2], scopes[1].ids[2], scopes[2].ids[2]}
	if got := GetSrcAvIDsForRefresh(seeds); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected mixed-scope dependents: got %v, want %v", got, want)
	}
}
