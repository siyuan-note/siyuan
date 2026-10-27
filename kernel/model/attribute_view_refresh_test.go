// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRefreshRelatedSrcAvsQueuesTransitiveDependents(t *testing.T) {
	tests := []struct {
		name      string
		relations [][2]string
		want      []string
	}{
		{
			name:      "chain",
			relations: [][2]string{{"B", "A"}, {"C", "B"}},
			want:      []string{"B", "C"},
		},
		{
			name: "diamond with cycles and self loops",
			relations: [][2]string{
				{"A", "A"}, {"B", "A"}, {"C", "A"}, {"D", "B"},
				{"D", "C"}, {"A", "D"}, {"B", "B"}, {"D", "D"},
			},
			want: []string{"B", "C", "D"},
		},
		{
			name:      "self loop only",
			relations: [][2]string{{"A", "A"}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			previousDataDir := util.DataDir
			util.DataDir = t.TempDir()
			t.Cleanup(func() { util.DataDir = previousDataDir })

			avDir := filepath.Join(util.DataDir, "storage", "av")
			if err := os.MkdirAll(avDir, 0755); nil != err {
				t.Fatal(err)
			}
			ids := map[string]string{}
			for _, name := range []string{"A", "B", "C", "D"} {
				ids[name] = ast.NewNodeID()
				if err := os.WriteFile(filepath.Join(avDir, ids[name]+".json"), []byte("{}"), 0644); nil != err {
					t.Fatal(err)
				}
			}
			for _, relation := range test.relations {
				av.UpsertAvBackRel(ids[relation[0]], ids[relation[1]])
			}

			tx := &Transaction{}
			refreshRelatedSrcAvs(ids["A"], tx)
			var want []string
			for _, name := range test.want {
				want = append(want, ids[name])
			}
			if !reflect.DeepEqual(tx.relatedAvIDs, want) {
				t.Fatalf("unexpected queued refreshes: got %v, want %v", tx.relatedAvIDs, want)
			}
		})
	}
}
