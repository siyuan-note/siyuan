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
		after, err := json.Marshal(bookmarkContracts(values))
		if err != nil || string(before) != string(after) {
			t.Fatalf("bookmark conversion mismatch: %s != %s, %v", before, after, err)
		}
	}
}
