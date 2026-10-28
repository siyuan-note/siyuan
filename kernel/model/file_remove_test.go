// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
)

func TestRemoveDocsRefreshesSuccessfulRemovalsOnFailure(t *testing.T) {
	for _, failAt := range []int{0, 1, 3} {
		t.Run(fmt.Sprintf("failure-after-%d", failAt), func(t *testing.T) {
			box := &Box{ID: "20261026000000-box0001"}
			dir := t.TempDir()
			paths := map[string]*Box{}
			for _, name := range []string{"a.sy", "b.sy", "c.sy"} {
				p := filepath.Join(dir, name)
				paths[p] = box
				if err := os.WriteFile(p, []byte("original"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			injected := errors.New("injected document deletion failure")
			var removed []*parse.Tree
			refreshes := 0
			err := removeDocs(paths, lute.New(), func(box *Box, p string, _ *lute.Lute) (*parse.Tree, error) {
				if len(removed) == failAt {
					return nil, injected
				}
				if err := os.Remove(p); err != nil {
					t.Fatal(err)
				}
				tree := &parse.Tree{Box: box.ID, Path: p}
				removed = append(removed, tree)
				return tree, nil
			}, func(trees []*parse.Tree) {
				refreshes++
				if len(trees) != len(removed) {
					t.Fatalf("refresh omitted successful deletions: got %d want %d", len(trees), len(removed))
				}
				for i, tree := range trees {
					if tree != removed[i] {
						t.Fatal("refresh included an unsuccessful deletion")
					}
				}
			})
			if refreshes != 1 || len(removed) != failAt {
				t.Fatalf("unexpected deletion finalization: refreshes=%d removed=%d", refreshes, len(removed))
			}
			if failAt < len(paths) && (!errors.Is(err, injected) || !strings.Contains(err.Error(), fmt.Sprintf("%d of 3 documents", failAt))) {
				t.Fatalf("partial failure was not reported: %v", err)
			}
			if failAt == len(paths) && err != nil {
				t.Fatal(err)
			}
			remaining, readErr := os.ReadDir(dir)
			if readErr != nil || len(remaining) != len(paths)-failAt {
				t.Fatalf("unexpected remaining originals: %v %v", remaining, readErr)
			}
		})
	}
}
