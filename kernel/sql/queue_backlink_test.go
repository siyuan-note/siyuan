// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import "testing"

func TestBacklinkIndexChange(t *testing.T) {
	change := newBacklinkIndexChange()
	change.addOperation(&dbQueueOperation{
		action: "update_block_content",
		block:  &Block{RootID: "20260725000000-source"},
	})
	change.addOperation(&dbQueueOperation{
		action:        "delete_ids",
		removeTreeIDs: []string{"20260725000000-deleted"},
	})
	change.addOperation(&dbQueueOperation{action: "delete_assets"})

	data := change.data()
	if !data["backlinkChanged"].(bool) || data["backlinkFull"].(bool) {
		t.Fatalf("unexpected change flags: %#v", data)
	}
	rootIDs := data["rootIDs"].([]string)
	if len(rootIDs) != 2 || rootIDs[0] != "20260725000000-deleted" || rootIDs[1] != "20260725000000-source" {
		t.Fatalf("unexpected root IDs: %#v", rootIDs)
	}

	change.addOperation(&dbQueueOperation{action: "delete_box"})
	if !change.data()["backlinkFull"].(bool) {
		t.Fatal("expected full backlink change")
	}
}
