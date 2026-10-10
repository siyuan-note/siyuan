package sql

import (
	"fmt"
	"testing"
)

func TestBlockQueriesBeyondVariableLimit(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprint(scoped), func(t *testing.T) {
			database, boxID := useEncryptedQueryTestDB(t)
			oldDB, oldDisabled := db, cacheDisabled
			db, cacheDisabled = database, true
			t.Cleanup(func() { db, cacheDisabled = oldDB, oldDisabled })
			insertEncryptedQueryTestBlock(t, database, "first", "", "first", "d")
			insertEncryptedQueryTestBlock(t, database, "last", "", "last", "d")
			ids := make([]string, 33001)
			for i := range ids {
				ids[i] = fmt.Sprintf("missing-%d", i)
			}
			ids[0], ids[511], ids[512], ids[33000] = "last", "first", "last", "first"
			var blocks []*Block
			if scoped {
				blocks = GetBlocksInBox(ids, boxID)
			} else {
				blocks = GetBlocks(ids)
			}
			if len(blocks) != len(ids) {
				t.Fatalf("returned %d blocks, want %d", len(blocks), len(ids))
			}
			for i, id := range ids {
				if id == "first" || id == "last" {
					if blocks[i] == nil || blocks[i].ID != id {
						t.Fatalf("existing block at %d was lost: %+v", i, blocks[i])
					}
				} else if blocks[i] != nil {
					t.Fatalf("missing block at %d was unexpectedly found", i)
				}
			}
		})
	}
}
