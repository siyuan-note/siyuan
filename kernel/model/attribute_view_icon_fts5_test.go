//go:build fts5

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
)

func TestAttributeViewItemIconLifecycle(t *testing.T) {
	fixture, view, binding := setupAttributeViewBindingUndoTest(t, false)
	itemID := binding.DoOperations[0].PreviousID
	keyID := view.GetBlockKeyValues().Key.ID
	update := func(data any) *av.Value {
		t.Helper()
		value, err := UpdateAttributeViewCell(nil, view.ID, keyID, itemID, data)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	assertIcon := func(want string, detached bool) {
		t.Helper()
		value := readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID)
		if value.Block.Icon != want || value.IsDetached != detached {
			t.Fatalf("unexpected persisted item: %+v, block: %+v", value, value.Block)
		}
	}
	for _, icon := range []string{"1f680", "", "1f600"} {
		update(map[string]any{"block": map[string]any{"icon": icon}})
		assertIcon(icon, true)
	}
	update(map[string]any{"block": map[string]any{"content": "Renamed"}})
	assertIcon("1f600", true)

	// 绑定和重新绑定始终采用目标块图标，取消绑定保留最后显示的图标。
	for index, blockID := range []string{fixture.sourceID, fixture.targetID} {
		icon := []string{"1f4c4", "1f4d6"}[index]
		tree, err := LoadTreeByBlockID(blockID)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("icon", icon)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			if err = PerformTxSync(binding); err != nil {
				t.Fatal(err)
			}
		} else {
			update(map[string]any{"isDetached": false, "block": map[string]any{"id": blockID}})
		}
		assertIcon(icon, false)
	}
	update(map[string]any{"isDetached": true, "block": map[string]any{"content": "Detached"}})
	assertIcon("1f4d6", true)
	update(map[string]any{"block": map[string]any{"icon": "1f680"}})
	assertIcon("1f680", true)
	tree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	if tree.Root.IALAttr("icon") != "1f4d6" {
		t.Fatal("editing a detached item changed the previously bound document icon")
	}
}
