// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationDetailViewStorage(t *testing.T) {
	var legacy Relation
	if err := json.Unmarshal([]byte(`{"avID":"target","isTwoWay":false,"backKeyID":""}`), &legacy); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(legacy)
	if err != nil || legacy.DetailView != nil || bytes.Contains(encoded, []byte("detailView")) {
		t.Fatalf("legacy relation gained a detail configuration: %s %v", encoded, err)
	}

	viewID := ast.NewNodeID()
	for _, enabled := range []bool{false, true} {
		relation := &Relation{AvID: ast.NewNodeID(), DetailView: &RelationDetailView{
			Spec: RelationDetailViewSpec, Enabled: enabled, ViewID: viewID}}
		encoded, err = gulu.JSON.MarshalJSON(relation)
		if err != nil {
			t.Fatal(err)
		}
		var restored Relation
		if err = gulu.JSON.UnmarshalJSON(encoded, &restored); err != nil || restored.DetailView == nil ||
			restored.DetailView.Spec != RelationDetailViewSpec || restored.DetailView.Enabled != enabled || restored.DetailView.ViewID != viewID {
			t.Fatalf("detail configuration did not round-trip: %s %v", encoded, err)
		}
	}

	for _, raw := range []string{
		`{"spec":99,"enabled":true,"viewID":"future-view","future":{"id":"untouched","large":9007199254740993}}`,
		`{"spec":99,"enabled":{"future":true},"viewID":["future-view"]}`,
	} {
		var config RelationDetailView
		if err = gulu.JSON.UnmarshalJSON([]byte(raw), &config); err != nil {
			t.Fatalf("future configuration cannot be retained: %v", err)
		}
		if err = config.Validate(); err == nil {
			t.Fatal("future specification was accepted for use")
		}
		encoded, err = gulu.JSON.MarshalJSON(&config)
		if err != nil || !bytes.Equal(encoded, []byte(raw)) {
			t.Fatalf("future configuration was changed: %s %v", encoded, err)
		}
	}

	var extended RelationDetailView
	raw := `{"spec":1,"enabled":true,"viewID":"` + viewID + `","future":{"id":"untouched"}}`
	if err = json.Unmarshal([]byte(raw), &extended); err != nil {
		t.Fatal(err)
	}
	extended.Enabled = false
	encoded, err = json.Marshal(extended)
	if err != nil || !bytes.Contains(encoded, []byte(`"future":{"id":"untouched"}`)) || !bytes.Contains(encoded, []byte(`"enabled":false`)) {
		t.Fatalf("editing supported configuration lost extension data: %s %v", encoded, err)
	}
}

func TestRelationDetailViewValidation(t *testing.T) {
	viewID := ast.NewNodeID()
	for _, test := range []struct {
		name   string
		config *RelationDetailView
		valid  bool
	}{
		{"absent", nil, true},
		{"disabled", &RelationDetailView{Spec: 1}, true},
		{"enabled", &RelationDetailView{Spec: 1, Enabled: true, ViewID: viewID}, true},
		{"retained-disabled-view", &RelationDetailView{Spec: 1, ViewID: viewID}, true},
		{"missing-version", &RelationDetailView{Enabled: true, ViewID: viewID}, false},
		{"unknown-version-disabled", &RelationDetailView{Spec: 99}, false},
		{"unknown-version", &RelationDetailView{Spec: 99, Enabled: true, ViewID: viewID}, false},
		{"missing-view", &RelationDetailView{Spec: 1, Enabled: true}, false},
		{"invalid-view", &RelationDetailView{Spec: 1, Enabled: true, ViewID: "../view"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.config.Validate(); (err == nil) != test.valid {
				t.Fatalf("unexpected validation result: %v", err)
			}
		})
	}
}

func TestRelationDetailViewResolution(t *testing.T) {
	first := &View{ID: ast.NewNodeID(), LayoutType: LayoutTypeTable, Table: NewLayoutTable()}
	selected := &View{ID: ast.NewNodeID(), LayoutType: LayoutTypeTable, Table: NewLayoutTable()}
	list := &View{ID: ast.NewNodeID(), LayoutType: LayoutTypeList, List: NewLayoutTable()}
	target := &AttributeView{Views: []*View{nil, list, first, selected}}
	config := &RelationDetailView{Spec: 1, Enabled: true, ViewID: selected.ID}
	if view, err := target.ResolveRelationDetailView(config); err != nil || view != selected {
		t.Fatalf("configured table was not selected: %v", err)
	}
	missingID := ast.NewNodeID()
	config.ViewID = missingID
	if view, err := target.ResolveRelationDetailView(config); err != ErrViewNotFound || view != nil || config.ViewID != missingID || len(target.Views) != 4 {
		t.Fatalf("missing table silently selected another view or changed storage: %v", err)
	}
	config.ViewID = list.ID
	if _, err := target.ResolveRelationDetailView(config); err == nil {
		t.Fatal("non-table configured view was accepted")
	}
	config.ViewID = missingID
	target.Views = []*View{nil, list, {ID: ast.NewNodeID(), LayoutType: LayoutTypeTable}}
	if _, err := target.ResolveRelationDetailView(config); err == nil {
		t.Fatal("unavailable table did not return an error")
	}
	for _, invalid := range []*RelationDetailView{nil, {Spec: 1}, {Spec: 99, Enabled: true, ViewID: selected.ID}} {
		if _, err := target.ResolveRelationDetailView(invalid); err == nil {
			t.Fatal("disabled or unsupported detail view was used")
		}
	}
}

func TestRelationDetailViewTemplateClone(t *testing.T) {
	source, _ := subItemsFixture(2)
	viewID := source.Views[0].ID
	source.KeyValues[1].Key.Relation.DetailView = &RelationDetailView{Spec: 1, Enabled: true, ViewID: viewID}
	source.KeyValues[2].Key.Relation.DetailView = &RelationDetailView{Spec: 1, Enabled: false, ViewID: viewID}
	ordinary := &Key{ID: ast.NewNodeID(), Type: KeyTypeRelation, Relation: &Relation{AvID: ast.NewNodeID(),
		DetailView: &RelationDetailView{Spec: 1, Enabled: true, ViewID: ast.NewNodeID()}}}
	source.KeyValues = append(source.KeyValues, &KeyValues{Key: ordinary})
	source.Views[0].Groups = []*View{{ID: ast.NewNodeID(), GroupKey: source.KeyValues[1].Key}, {ID: ast.NewNodeID(), GroupKey: ordinary}}
	before, _ := json.Marshal(source)
	cloned := source.Clone()
	if cloned == nil {
		t.Fatal("clone failed")
	}
	for _, keyID := range []string{cloned.SubItems.ParentKeyID, cloned.SubItems.ChildrenKeyID} {
		key, err := cloned.GetKey(keyID)
		if err != nil || key.Relation.DetailView == nil || key.Relation.DetailView.ViewID != cloned.Views[0].ID ||
			key.Relation.DetailView.ViewID == viewID || key.Relation.AvID != cloned.ID {
			t.Fatalf("template self-relation did not map its detail view: %v", err)
		}
	}
	if relation := cloned.KeyValues[len(cloned.KeyValues)-1].Key.Relation; relation.AvID != "" || relation.DetailView != nil {
		t.Fatal("disconnected template relation retained a detail view")
	}
	if cloned.Views[0].Groups[0].GroupKey.Relation.DetailView.ViewID != cloned.Views[0].ID ||
		cloned.Views[0].Groups[0].GroupKey.Relation.AvID != cloned.ID || cloned.Views[0].Groups[1].GroupKey.Relation.DetailView != nil {
		t.Fatal("template group metadata retained its source detail view")
	}
	after, _ := json.Marshal(source)
	if !bytes.Equal(before, after) {
		t.Fatal("clone changed its source")
	}
}

func TestRelationDetailViewPersistence(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			oldData := util.DataDir
			oldDEK, oldEncrypted, oldUnlocked := AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked
			oldAcquire, oldRelease := AVLockAcquire, AVLockRelease
			util.DataDir = t.TempDir()
			boxID, databaseID := "", ast.NewNodeID()
			if encrypted {
				boxID = ast.NewNodeID()
				AVDEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{0x47}, 32), nil }
				AVIsEncryptedBox = func(id string) bool { return id == boxID }
				AVIsBoxUnlocked = func(string) bool { return true }
				AVLockAcquire, AVLockRelease = func(string) {}, func(string) {}
				SetAVBoxID(databaseID, boxID)
			}
			t.Cleanup(func() {
				SetAVBoxID(databaseID, "")
				cache.RemoveAVDataInBox(databaseID, boxID)
				util.DataDir = oldData
				AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked = oldDEK, oldEncrypted, oldUnlocked
				AVLockAcquire, AVLockRelease = oldAcquire, oldRelease
			})
			keyID, viewID := ast.NewNodeID(), ast.NewNodeID()
			source := &AttributeView{ID: databaseID, Spec: PlainTextSpec,
				KeyValues: []*KeyValues{{Key: &Key{ID: keyID, Type: KeyTypeRelation, Relation: &Relation{AvID: databaseID}}}},
				Views:     []*View{{ID: viewID, LayoutType: LayoutTypeTable, Table: NewLayoutTable()}}}
			if err := SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			loaded, err := ParseAttributeViewInBox(databaseID, boxID)
			if err != nil || loaded.HasRelationDetailViews() {
				t.Fatalf("legacy database did not remain unconfigured: %v", err)
			}
			loaded.KeyValues[0].Key.Relation.DetailView = &RelationDetailView{Spec: 1, Enabled: true, ViewID: viewID}
			if err = SaveAttributeView(loaded); err != nil {
				t.Fatal(err)
			}
			cache.RemoveAVDataInBox(databaseID, boxID)
			loaded, err = ParseAttributeViewInBox(databaseID, boxID)
			if err != nil || loaded.KeyValues[0].Key.Relation.DetailView.ViewID != viewID {
				t.Fatalf("saved detail configuration did not survive reload: %v", err)
			}
			raw := `{"spec":99,"viewID":"` + viewID + `","enabled":true,"future":{"id":"keep-me"}}`
			if err = json.Unmarshal([]byte(raw), loaded.KeyValues[0].Key.Relation.DetailView); err != nil {
				t.Fatal(err)
			}
			if err = SaveAttributeView(loaded); err != nil {
				t.Fatal(err)
			}
			cache.RemoveAVDataInBox(databaseID, boxID)
			loaded, err = ParseAttributeViewInBox(databaseID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			loaded.Name = "Unrelated rename"
			if err = SaveAttributeView(loaded); err != nil {
				t.Fatal(err)
			}
			stored, err := ReadAttributeViewDataInBox(databaseID, boxID)
			if err != nil || !bytes.Contains(stored, []byte(raw)) {
				t.Fatalf("unrelated save changed an unknown configuration: %s %v", stored, err)
			}
			if encrypted {
				ciphertext, err := os.ReadFile(attributeViewDataPathByBox(databaseID, boxID))
				if err != nil || bytes.Contains(ciphertext, []byte("keep-me")) {
					t.Fatalf("detail configuration was not encrypted: %v", err)
				}
			}
		})
	}
}
