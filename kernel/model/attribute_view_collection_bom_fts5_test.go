// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionBOMDocumentEdits(t *testing.T) {
	for _, warm := range []bool{false, true} {
		t.Run(map[bool]string{false: "cold", true: "warm"}[warm], func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			path := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, append([]byte{0xef, 0xbb, 0xbf}, data...), 0600); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			if warm {
				if _, err = av.BlockCollectionIndexInBox(""); err != nil {
					t.Fatal(err)
				}
			}
			for _, tags := range []string{"todo", "todo,other"} {
				if err = PerformTxSync(blockCollectionTags(t, fixture.sourceID, tags)); err != nil {
					t.Fatal(err)
				}
			}
			loaded := readAttributeViewItemsTest(t, view.ID)
			if loaded.GetBlockValueByBoundID(fixture.sourceID) == nil || len(loaded.GetBlockKeyValues().Values) != 1 {
				t.Fatal("document edits did not preserve collection binding")
			}
		})
	}
}
