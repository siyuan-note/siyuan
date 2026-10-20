package api

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAPIContractAVDeprecatedLayoutProjection(t *testing.T) {
	raw, err := os.ReadFile("../av/testdata/spec1-deprecated-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	database, err := av.ParseAttributeViewData("20261010120001-encav00", raw)
	if err != nil {
		t.Fatal(err)
	}
	av.UpgradeSpec(database)
	for _, view := range database.Views {
		encoded, marshalErr := json.Marshal(toContractAVView(view))
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		var fields map[string]json.RawMessage
		if err = json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if len(fields["itemIds"]) == 0 || len(fields["filters"]) == 0 || len(fields["pageSize"]) == 0 ||
			(view.Table != nil && len(fields["sorts"]) == 0) {
			t.Fatalf("active view fields missing: %s", encoded)
		}
		var layout map[string]json.RawMessage
		if err = json.Unmarshal(fields[string(view.LayoutType)], &layout); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"rowIds", "cardIds", "filters", "sorts", "pageSize"} {
			if _, exists := layout[name]; exists {
				t.Fatalf("deprecated layout field %s is exposed", name)
			}
		}
	}
}
