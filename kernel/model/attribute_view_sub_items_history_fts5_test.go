// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSubItemsBoundHistoryGroupOrder(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, mode := range []string{"original", "later-order", "fallback-order"} {
			t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted]+"/"+mode, func(t *testing.T) {
				fixture, source, _, _ := setupSubItemsTest(t, true)
				ids := slices.Clone(source.Views[0].ItemIDs)
				if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0], ids[3]: ids[0]}); err != nil {
					t.Fatal(err)
				}
				view := source.Views[0]
				view.SubItemsDisplay = "nested"
				key := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeMSelect, Options: []*av.SelectOption{{Name: "A"}, {Name: "C"}, {Name: "D"}}}
				addAttributeViewKey(source, view, key, "")
				field, _ := source.GetKeyValues(key.ID)
				for i, choice := range []string{"A", "C", "C", "D"} {
					field.Values = append(field.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: ids[i], Type: key.Type, MSelect: []*av.ValueSelect{{Content: choice}}})
				}
				view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
				regenAttrViewGroups(source)
				wanted := []string{ids[0], ids[2], ids[1], ids[3]}
				view.GetGroupByGroupValue("A").SubItemsItemIDs = slices.Clone(wanted)
				tree, err := LoadTreeByBlockID(fixture.targetID)
				if err != nil {
					t.Fatal(err)
				}
				boxID := ""
				if encrypted {
					boxID = ast.NewNodeID()
					markRuntimeEncryptedBox(boxID)
					prepareUnlockedEncryptedBoxTest(t, boxID, bytes.Repeat([]byte{0x67}, 32))
					av.SetAVBoxID(source.ID, boxID)
					tree.Box = boxID
					t.Cleanup(func() {
						av.SetAVBoxID(source.ID, "")
						forgetRuntimeEncryptedBox(boxID)
						encryptedBoxLifecycles.Delete(boxID)
						cachedDEKsLock.Lock()
						delete(cachedDEKs, boxID)
						cachedDEKsLock.Unlock()
					})
				}
				if err = av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
				if encrypted {
					if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", source.ID+".json")); err != nil {
						t.Fatal(err)
					}
				}
				historyDir := t.TempDir()
				if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
					t.Fatal(err)
				}
				historyPath := boundAttributeViewHistoryPath(historyDir, boxID, source.ID)
				historical, err := os.ReadFile(historyPath)
				if err != nil || util.IsCiphertext(historical) != encrypted {
					t.Fatalf("invalid history source: %v", err)
				}
				current, err := cloneAttributeViewForFieldMutation(source)
				if err != nil {
					t.Fatal(err)
				}
				if !removeAttributeViewBoundItems(current, map[string]struct{}{fixture.targetID: {}}, true) {
					t.Fatal("bound child was not removed")
				}
				if mode != "original" {
					current.Views[0].GetGroupByGroupValue("A").SubItemsItemIDs = []string{ids[0], ids[3], ids[2]}
					wanted = []string{ids[0], ids[3], ids[2], ids[1]}
				}
				if mode == "fallback-order" {
					current.Views[0].GetGroupByGroupValue("A").SubItemsItemIDs = nil
					current.Views[0].ItemIDs = []string{ids[0], ids[3], ids[2]}
				}
				if err = av.SaveAttributeView(current); err != nil {
					t.Fatal(err)
				}
				tx := &Transaction{trees: map[string]*parse.Tree{}}
				err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
				tx.finishAttributeViewMutation(err != nil)
				if err != nil {
					t.Fatal(err)
				}
				restored, err := av.ParseAttributeViewForIndexInBox(source.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				if actual := restored.Views[0].GetGroupByGroupValue("A").SubItemsItemIDs; !slices.Equal(actual, wanted) {
					t.Fatalf("history lost tree order or overwrote later order: got %v want %v", actual, wanted)
				}
				result := nestedRender(t, restored, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}}})
				found := false
				for _, instance := range result.Groups {
					table := av.TableFromViewable(instance)
					if table.Name != "A" {
						continue
					}
					found = true
					actual := []string{}
					for _, row := range table.Rows {
						actual = append(actual, row.ID)
					}
					if !slices.Equal(actual, wanted) {
						t.Fatalf("history restored child at wrong visible position: %v", actual)
					}
				}
				if !found {
					t.Fatal("restored group is missing")
				}
				preserved, err := os.ReadFile(historyPath)
				if err != nil || !bytes.Equal(historical, preserved) {
					t.Fatal("history restoration modified recovery source")
				}
			})
		}
	}
}
