//go:build fts5

package model

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewPanelVisibilityPersistenceAndReplay(t *testing.T) {
	fixture, before, _ := setupAttributeViewBindingUndoTest(t, true)
	keyID := before.KeyValues[2].Key.ID
	assertVisibility := func(want string) {
		t.Helper()
		current := readAttributeViewItemsTest(t, before.ID)
		key, err := current.GetKey(keyID)
		if nil != err || key.AttributePanelVisibility != want {
			t.Fatalf("unexpected persisted visibility: %+v, %v", key, err)
		}
		key.AttributePanelVisibility = ""
		assertAttributeViewItemsEqual(t, before, current)
	}
	assertVisibility("")
	for _, visibility := range []string{"always", "hide-empty", "hide"} {
		tx := &Transaction{fromAPI: true,
			DoOperations: []*Operation{{Action: "setAttrViewColAttributePanelVisibility", AvID: before.ID,
				ID: keyID, BlockID: fixture.sourceID, Data: visibility}},
			UndoOperations: []*Operation{{Action: "setAttrViewColAttributePanelVisibility", AvID: before.ID,
				ID: keyID, BlockID: fixture.sourceID, Data: ""}},
		}
		if err := PerformTxSync(tx); nil != err {
			t.Fatal(err)
		}
		assertVisibility(visibility)
		if err := PerformTxSync(&Transaction{DoOperations: tx.UndoOperations, isReplay: true}); nil != err {
			t.Fatal(err)
		}
		assertVisibility("")
	}
	for _, value := range []any{"unknown", true, nil} {
		if err := setAttrViewColAttributePanelVisibility(&Operation{AvID: before.ID, ID: keyID, Data: value}); nil == err {
			t.Fatalf("invalid visibility accepted: %v", value)
		}
		assertVisibility("")
	}
	if err := setAttrViewColAttributePanelVisibility(&Operation{AvID: before.ID, ID: "missing", Data: "hide"}); nil == err {
		t.Fatal("missing field accepted")
	}
	assertVisibility("")
}

func TestAttributeViewPanelVisibilityLegacyKey(t *testing.T) {
	var key av.Key
	if err := json.Unmarshal([]byte(`{"id":"20260930120000-field01","name":"Notes","type":"text","icon":"","desc":"","numberFormat":"","template":""}`), &key); nil != err {
		t.Fatal(err)
	}
	if key.AttributePanelVisibility != "" {
		t.Fatal("legacy field must inherit the global setting")
	}
	data, err := json.Marshal(key)
	if nil != err {
		t.Fatal(err)
	}
	var stored map[string]any
	if err = json.Unmarshal(data, &stored); nil != err {
		t.Fatal(err)
	}
	if _, exists := stored["attributePanelVisibility"]; exists {
		t.Fatal("default visibility must remain absent from legacy data")
	}
}
