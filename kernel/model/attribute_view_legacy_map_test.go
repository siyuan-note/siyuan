package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyMapCannotBeSelectedAsNewLayout(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	database := newAttributeViewWithLayout("20260921000000-layouts", "map")
	view := database.Views[0]
	if view.LayoutType != av.LayoutTypeTable || len(view.LegacyMap) != 0 {
		t.Fatal("a new map layout was created")
	}
	if err := changeAttrViewLayout(database, view, "map"); err != av.ErrWrongLayoutType || view.LayoutType != av.LayoutTypeTable {
		t.Fatalf("the retired map layout was selected: %v", err)
	}
}

func TestLegacyMapAuthenticatedRecoveryAndExport(t *testing.T) {
	fixture, err := os.ReadFile("../av/testdata/spec13-retired-map.json")
	if err != nil {
		t.Fatal(err)
	}
	const avID, keyID, itemID = "20260921000000-layouts", "20261009000001-locakey", "20260921000003-example"
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			setupAttributeViewValidationTest(t)
			boxID := ""
			source := bytes.Clone(fixture)
			if encrypted {
				boxID = "20261009000000-cryptob"
				t.Cleanup(prepareEncryptedBoxLifecycleTest(t, boxID))
				av.SetAVBoxID(avID, boxID)
				t.Cleanup(func() { av.SetAVBoxID(avID, "") })
				source, err = av.EncryptAVData(boxID, avID, fixture)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
			if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, source, 0600); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			info, err := av.GetAttributeViewSearchInfoInBox(avID, boxID)
			if err != nil || info == nil || info.Views[0].LayoutType != av.LayoutTypeTable {
				t.Fatalf("cold-cache search exposed a retired map layout: %+v, %v", info, err)
			}
			original, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			legacy := bytes.Clone(original.Views[0].LegacyMap)
			location := *original.GetValue(keyID, itemID).Location
			if original.Views[0].LayoutType != av.LayoutTypeTable || len(legacy) == 0 || len(original.Views) != 3 {
				t.Fatal("legacy map or other views were lost")
			}
			for _, view := range original.Views {
				if table := getAttrViewTable(original, view, ""); table == nil || len(table.Rows) != 1 {
					t.Fatalf("legacy record export failed: %s", view.LayoutType)
				}
			}
			before, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, source) {
				t.Fatal("read or export changed the original file")
			}
			if err = av.SaveAttributeView(original); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			stored, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || !equalLegacyMapJSON(t, stored.Views[0].LegacyMap, legacy) || !reflect.DeepEqual(location, *stored.GetValue(keyID, itemID).Location) {
				t.Fatalf("saving lost legacy configuration or coordinates: %v", err)
			}
			plain, err := decryptHistoricalAttributeView(boxID, avID, source)
			if err != nil {
				t.Fatal(err)
			}
			historical, err := parseHistoricalAttributeViewData(avID, plain)
			if err != nil || historical.Views[0].LayoutType != av.LayoutTypeTable || !equalLegacyMapJSON(t, historical.Views[0].LegacyMap, legacy) {
				t.Fatalf("history or backup recovery lost the legacy layout: %v", err)
			}
			if err = av.SaveAttributeView(historical); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				storedBytes, err := os.ReadFile(path)
				if err != nil || !util.IsCiphertext(storedBytes) {
					t.Fatal("legacy map recovery removed encryption")
				}
				corrupt := bytes.Clone(source)
				corrupt[len(corrupt)-1] ^= 1
				if _, err = decryptHistoricalAttributeView(boxID, avID, corrupt); err == nil {
					t.Fatal("unauthenticated history was accepted")
				}
				after, _ := os.ReadFile(path)
				if !bytes.Equal(after, storedBytes) {
					t.Fatal("authentication failure changed the saved database")
				}
			}
		})
	}
}

func equalLegacyMapJSON(t *testing.T, first, second []byte) bool {
	t.Helper()
	var left, right any
	if err := json.Unmarshal(first, &left); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(second, &right); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(left, right)
}
