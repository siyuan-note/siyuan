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
