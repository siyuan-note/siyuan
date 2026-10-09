//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewLocationDefaultPersistenceAndReplay(t *testing.T) {
	fixture, before, _, _ := setupAttributeViewItemsTest(t, false)
	var locations *av.KeyValues
	for _, values := range before.KeyValues {
		if values.Key.Type == av.KeyTypeLocation {
			locations = values
			break
		}
	}
	if locations == nil {
		t.Fatal("location fixture missing")
	}
	locations.Values[0].Location.CoordinateSystem = "unknown"
	locations.Values[1].Location = &av.ValueLocation{Name: "Named", OriginalInput: "name source"}
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	previousValues, _ := json.Marshal(locations.Values)
	keyID := locations.Key.ID
	for _, crs := range []string{"gcj02", "wgs84", "bd09", "unknown"} {
		tx := &Transaction{fromAPI: true,
			DoOperations:   []*Operation{{Action: "setAttrViewColLocationDefaultCoordinateSystem", AvID: before.ID, ID: keyID, BlockID: fixture.sourceID, Data: crs}},
			UndoOperations: []*Operation{{Action: "setAttrViewColLocationDefaultCoordinateSystem", AvID: before.ID, ID: keyID, BlockID: fixture.sourceID, Data: "unknown"}},
		}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		current := readAttributeViewItemsTest(t, before.ID)
		values, _ := current.GetKeyValues(keyID)
		actualValues, _ := json.Marshal(values.Values)
		if values.Key.Location == nil || values.Key.Location.DefaultCoordinateSystem != crs || !bytes.Equal(previousValues, actualValues) {
			t.Fatalf("default changed existing values: %+v", values.Key.Location)
		}
		data, _ := json.Marshal(current)
		imported, err := isolateImportedAttributeViewBindings(data, nil, true)
		if err != nil || !bytes.Equal(data, imported) {
			t.Fatalf("import reinterpreted location defaults or coordinates: %v", err)
		}
		if clone, err := cloneAttributeViewForFieldMutation(current); err != nil {
			t.Fatal(err)
		} else if copied, _ := json.Marshal(clone.KeyValues); !bytes.Equal(copied, mustLocationKeyValuesJSON(t, current.KeyValues)) {
			t.Fatal("copy changed location configuration")
		}
		if err := PerformTxSync(&Transaction{DoOperations: tx.UndoOperations, isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current = readAttributeViewItemsTest(t, before.ID)
		key, _ := current.GetKey(keyID)
		if key.Location.DefaultCoordinateSystem != "unknown" {
			t.Fatal("undo did not restore coordinate system default")
		}
	}
	path := av.GetAttributeViewDataPath(before.ID)
	prior, _ := os.ReadFile(path)
	for _, data := range []any{"", "WGS84", "invalid", true, nil} {
		if err := setAttrViewColLocationDefaultCoordinateSystem(&Operation{AvID: before.ID, ID: keyID, Data: data}); err == nil {
			t.Fatalf("invalid column default accepted: %v", data)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(prior, after) {
			t.Fatal("invalid default rewrote database")
		}
	}
	if err := setAttrViewColLocationDefaultCoordinateSystem(&Operation{AvID: before.ID, ID: before.GetBlockKey().ID, Data: "wgs84"}); err == nil {
		t.Fatal("non-location field accepted location settings")
	}
}

func mustLocationKeyValuesJSON(t *testing.T, values []*av.KeyValues) []byte {
	t.Helper()
	data, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
