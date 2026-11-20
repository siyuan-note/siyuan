// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractBookmarkModelConversion(t *testing.T) {
	for _, values := range []*model.Bookmarks{nil, {}, {nil, {Name: "bookmark", Type: "bookmark", Depth: 1, Count: 2, Blocks: []*model.Block{{ID: "id", Children: []*model.Block{{ID: "child"}}}}}}} {
		before, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(bookmarkContracts(values, false))
		if err != nil || string(before) != string(after) {
			t.Fatalf("bookmark conversion mismatch: %s != %s, %v", before, after, err)
		}
	}
}

// TestReaderBookmarkContractsRedactMemo 校验读者书签中的块备注被剔除，管理员结果保持不变。
func TestReaderBookmarkContractsRedactMemo(t *testing.T) {
	const canary = "BOOKMARK_MEMO_CANARY_5e8b"
	values := &model.Bookmarks{{Name: "bookmark", Type: "bookmark", Depth: 1, Count: 1,
		Blocks: []*model.Block{{ID: "block", Memo: canary, IAL: map[string]string{"memo": canary}}}}}
	reader := bookmarkContracts(values, true)
	if 1 != len(reader) || 1 != len(reader[0].Blocks) || "" != reader[0].Blocks[0].Memo || "" != reader[0].Blocks[0].IAL["memo"] {
		t.Fatalf("reader received the bookmark block memo: %#v", reader)
	}
	admin := bookmarkContracts(values, false)
	if canary != admin[0].Blocks[0].Memo || canary != admin[0].Blocks[0].IAL["memo"] {
		t.Fatalf("administrator lost the bookmark block memo: %#v", admin)
	}
}
