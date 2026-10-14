package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func modelLocationCoordinate(value float64) *float64 { return &value }

func TestUpdateAttributeViewLocationPartialAndInvalid(t *testing.T) {
	const keyID, itemID = "20261009000001-locakey", "20261009000002-locarow"
	value := &av.Value{ID: "20261009000003-locaval", KeyID: keyID, BlockID: itemID,
		Type: av.KeyTypeLocation, CreatedAt: 100, UpdatedAt: 200,
		Location: &av.ValueLocation{Name: "Home", Latitude: modelLocationCoordinate(0),
			Longitude: modelLocationCoordinate(120), OriginalInput: "original"}}
	view := &av.AttributeView{ID: "20261009000000-locatav", KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "20261009000004-locabky", Type: av.KeyTypeBlock}, Values: []*av.Value{{
			BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Entry"}}}},
		{Key: &av.Key{ID: keyID, Type: av.KeyTypeLocation}, Values: []*av.Value{value}},
	}}
	update := func(payload map[string]any) error {
		_, err := updateAttributeViewValue0(nil, view, keyID, itemID, payload, false, nil)
		return err
	}
	for _, patch := range []map[string]any{
		{"location": map[string]any{"name": "Changed", "latitude": 91}},
		{"location": map[string]any{"latitude": nil}},
		{"location": map[string]any{"longitude": -181}},
		{"location": map[string]any{"coordinateSystem": "WGS84"}},
		{"location": map[string]any{"coordinateSystem": "wgs84"}},
		{"location": map[string]any{"coordinateSystem": "unknown"}},
		{"location": map[string]any{"coordinateSystem": "gcj02"}},
		{"location": map[string]any{"coordinateSystem": nil}},
		{"location": map[string]any{"name": "Changed", "unknown": true}},
		{"location": map[string]any{"latitude": "wrong"}},
	} {
		before, _ := json.Marshal(view)
		if err := update(patch); err == nil {
			t.Fatalf("invalid patch accepted: %v", patch)
		}
		after, _ := json.Marshal(view)
		if !bytes.Equal(before, after) {
			t.Fatalf("failed save=false patch mutated cached database: %s", after)
		}
	}
	if err := update(map[string]any{"location": map[string]any{"name": "Office"}}); err != nil {
		t.Fatal(err)
	}
	if value.Location.Name != "Office" || *value.Location.Latitude != 0 || *value.Location.Longitude != 120 ||
		value.Location.OriginalInput != "original" || value.CreatedAt != 100 {
		t.Fatalf("partial update lost location data: %+v", value)
	}
	if err := update(map[string]any{"location": map[string]any{"latitude": 0}}); err != nil || value.Location.OriginalInput != "original" {
		t.Fatalf("no-op coordinate patch removed provenance: %v", err)
	}
	if err := update(map[string]any{"location": map[string]any{"latitude": 1}}); err != nil || value.Location.OriginalInput != "" || *value.Location.Longitude != 120 {
		t.Fatalf("changed coordinate retained stale provenance or lost partner: %v", err)
	}
	if err := update(map[string]any{"location": map[string]any{"latitude": 2, "originalInput": "new source"}}); err != nil || value.Location.OriginalInput != "new source" {
		t.Fatalf("explicit provenance replacement: %v", err)
	}
	if err := update(map[string]any{"LOCATION": map[string]any{"latitude": 3, "ORIGINALINPUT": "uppercase source"}}); err != nil || value.Location.OriginalInput != "uppercase source" {
		t.Fatalf("case-insensitive provenance member: %v", err)
	}
	if err := update(map[string]any{"LOCATION": map[string]any{"ORIGINALINPUT": nil}}); err != nil || value.Location.OriginalInput != "" {
		t.Fatalf("explicit null did not clear provenance: %v", err)
	}
	if err := update(map[string]any{"location": map[string]any{"originalInput": "cleared with coordinates"}}); err != nil {
		t.Fatal(err)
	}
	if err := update(map[string]any{"location": map[string]any{"latitude": nil, "longitude": nil}}); err != nil {
		t.Fatal(err)
	}
	if value.Location.Latitude != nil || value.Location.Longitude != nil || value.Location.OriginalInput != "" || value.String(false) != "Office" {
		t.Fatalf("explicit null coordinate pair did not clear: %+v", value.Location)
	}
	if err := update(map[string]any{"location": nil}); err != nil || !value.IsEmpty() {
		t.Fatalf("clearing location: %v, %+v", err, value)
	}
}

func TestAttributeViewLocationNoOpProvenance(t *testing.T) {
	previous := &av.ValueLocation{Latitude: modelLocationCoordinate(0), Longitude: modelLocationCoordinate(0), OriginalInput: "source"}
	updated := *previous
	normalizeAttributeViewLocationProvenance(previous, &updated, []byte(`{"location":{"latitude":0,"longitude":0}}`))
	if updated.OriginalInput != "source" {
		t.Fatal("no-op coordinates cleared provenance")
	}
}

func TestAttributeViewLocationAutomationReplacement(t *testing.T) {
	previous := &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Name: "Home", Latitude: modelLocationCoordinate(0), Longitude: modelLocationCoordinate(0), OriginalInput: "original"}}
	next := previous.Clone()
	next.Location.OriginalInput = "different provenance"
	if !equalAutomationValues(previous, next) {
		t.Fatal("provenance triggered an automation value change")
	}
	next.Location.Longitude = modelLocationCoordinate(1)
	if equalAutomationValues(previous, next) {
		t.Fatal("coordinate change was ignored")
	}
	for _, desired := range []*av.Value{
		{Type: av.KeyTypeLocation},
		{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Name: "Office"}},
		{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Latitude: modelLocationCoordinate(0), Longitude: modelLocationCoordinate(0)}},
	} {
		merged := previous.Clone()
		data, _ := json.Marshal(automationValuePatch(desired))
		if err := json.Unmarshal(data, merged); err != nil {
			t.Fatal(err)
		}
		if !equalAutomationValues(merged, desired) || merged.Location.OriginalInput != "" {
			t.Fatalf("replacement retained old location fields: %s", data)
		}
	}
}

func TestAttributeViewLocationEncryptedRecovery(t *testing.T) {
	fixture, err := os.ReadFile("../av/testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	const avID, locationKeyID = "20260921000000-layouts", "20261009000001-locakey"
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			setupAttributeViewValidationTest(t)
			boxID := ""
			legacySource := append([]byte(nil), fixture...)
			if encrypted {
				boxID = "20261009000000-cryptob"
				t.Cleanup(prepareEncryptedBoxLifecycleTest(t, boxID))
				av.SetAVBoxID(avID, boxID)
				t.Cleanup(func() { av.SetAVBoxID(avID, "") })
				legacySource, err = av.EncryptAVData(boxID, avID, fixture)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
			if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, legacySource, 0600); err != nil {
				t.Fatal(err)
			}
			view, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || view.Spec != 9 {
				t.Fatalf("legacy authenticated read: %v", err)
			}
			value := &av.Value{ID: "20261009000002-locaval", KeyID: locationKeyID, BlockID: "20260921000003-example", Type: av.KeyTypeLocation,
				Location: &av.ValueLocation{Name: "Home", Latitude: modelLocationCoordinate(0), Longitude: modelLocationCoordinate(0), OriginalInput: "original"}}
			view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: locationKeyID, Name: "Location", Type: av.KeyTypeLocation}, Values: []*av.Value{value}})
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			stored, _ := os.ReadFile(path)
			if encrypted && !util.IsCiphertext(stored) {
				t.Fatal("location upgrade removed encryption")
			}
			reloaded, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || reloaded.Spec != av.LocationSpec || !reflect.DeepEqual(value.Location, reloaded.GetValue(locationKeyID, value.BlockID).Location) {
				t.Fatalf("location round trip: %v", err)
			}
			plain, err := decryptHistoricalAttributeView(boxID, avID, stored)
			if err != nil {
				t.Fatal(err)
			}
			recovered, err := av.ParseAttributeViewData(avID, plain)
			if err != nil || recovered.GetValue(locationKeyID, value.BlockID).String(false) != "Home; 0, 0 [WGS84]" {
				t.Fatalf("historical location recovery: %v", err)
			}
			legacyPlain, err := decryptHistoricalAttributeView(boxID, avID, legacySource)
			if err != nil {
				t.Fatal(err)
			}
			if legacy, err := av.ParseAttributeViewData(avID, legacyPlain); err != nil || legacy.Spec != 9 {
				t.Fatalf("old historical format no longer readable: %v", err)
			}
			if encrypted {
				corrupt := append([]byte(nil), stored...)
				corrupt[len(corrupt)-1] ^= 1
				if _, err = decryptHistoricalAttributeView(boxID, avID, corrupt); err == nil {
					t.Fatal("unauthenticated location history accepted")
				}
				current, _ := os.ReadFile(path)
				if !bytes.Equal(stored, current) {
					t.Fatal("authentication failure modified source")
				}
			}
		})
	}
}

func TestAttributeViewLocationImportHistoryValidation(t *testing.T) {
	setupAttributeViewValidationTest(t)
	previousHistoryDir := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = previousHistoryDir })
	const avID = "20261009000000-locatav"
	created := time.Unix(1791514800, 0)
	path := filepath.Join(util.HistoryDir, created.Format("2006-01-02-150405")+"-update", "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	var inputs [][]byte
	for _, payload := range []string{
		`{"latitude":91,"longitude":0}`,
		`{"latitude":0,"longitude":181}`,
		`{"latitude":0}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"invalid"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"wgs84"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"gcj02"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"unknown"}`,
	} {
		inputs = append(inputs, []byte(`{"spec":13,"id":"`+avID+`","keyValues":[{"key":{"type":"location"},"values":[{"type":"location","location":`+payload+`}]}]}`))
	}
	for _, spec := range []string{"11", "12"} {
		inputs = append(inputs, []byte(`{"spec":`+spec+`,"id":"`+avID+`","keyValues":[{"key":{"type":"location"},"values":[{"type":"location","location":{"latitude":0,"longitude":0}}]}]}`))
	}
	for _, data := range inputs {
		for _, encryptedTarget := range []bool{false, true} {
			if _, err := isolateImportedAttributeViewBindings(data, nil, encryptedTarget); err == nil {
				t.Fatalf("invalid location imported: %s", data)
			}
		}
		if _, err := parseHistoricalAttributeViewData(avID, data); err == nil {
			t.Fatalf("invalid history/snapshot location accepted: %s", data)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RenderHistoryAttributeView(avID, "", "", "", 1, -1, nil, strconv.FormatInt(created.Unix(), 10)); err == nil {
			t.Fatalf("history preview accepted invalid location: %s", data)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(data, after) {
			t.Fatal("invalid history source was rewritten")
		}
	}
}

func TestAttributeViewLocationSaveRejectsInvalidAndFuture(t *testing.T) {
	setupAttributeViewValidationTest(t)
	const avID = "20261009000000-locatav"
	path := filepath.Join(util.DataDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	original := []byte(`{"spec":8,"id":"` + avID + `","keyValues":[],"views":[]}`)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []int{av.LocationSpec, av.CurrentSpec + 1} {
		view := &av.AttributeView{ID: avID, Spec: spec, KeyValues: []*av.KeyValues{{
			Key: &av.Key{Type: av.KeyTypeLocation}, Values: []*av.Value{{Type: av.KeyTypeLocation,
				Location: &av.ValueLocation{Latitude: modelLocationCoordinate(91), Longitude: modelLocationCoordinate(0)}}},
		}}}
		if err := av.SaveAttributeView(view); err == nil || spec > av.CurrentSpec && err != av.ErrSpecTooNew {
			t.Fatalf("invalid/future save result: %v", err)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(original, after) {
			t.Fatal("rejected save changed existing database")
		}
	}
}
