// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDailyNoteCollectsByDateAttribute(t *testing.T) {
	for _, mode := range []string{"today", "dated", "existing"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			view.Automations.Spec = 6
			rule := view.Automations.Rules[0]
			rule.BlockSource = &av.AutomationBlockSource{
				NotebookIDs: []string{fixture.box.ID}, Types: []string{"d"},
				Attributes: []*av.AutomationBlockAttribute{{Name: "dailynote", NameOperator: "contains", Operator: "exists"}},
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			boxConf := fixture.box.GetConf()
			boxConf.DailyNoteSavePath = "/Daily note/{{now | date \"2006-01-02\"}}"
			if mode == "existing" {
				boxConf.DailyNoteSavePath = "/Source"
			}
			if err := fixture.box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			date := time.Date(2024, 2, 29, 0, 0, 0, 0, time.Local)
			if mode != "dated" {
				date = time.Now()
			}
			create := func() (string, bool, error) {
				if mode == "dated" {
					return CreateDailyNoteAt(fixture.box.ID, date)
				}
				return CreateDailyNote(fixture.box.ID)
			}
			p, existed, err := create()
			if err != nil || existed != (mode == "existing") {
				t.Fatalf("create daily note: %s %v %v", p, existed, err)
			}
			id := util.GetTreeID(p)
			tree, err := LoadTreeByBlockID(id)
			if err != nil || tree.Root.IALAttr(DailyNoteAttrPrefix+date.Format("20060102")) != date.Format("20060102") {
				t.Fatal("missing daily note attribute", err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			row := view.GetBlockValueByBoundID(id)
			if row == nil || row.Block.CollectionRuleID != rule.ID || view.GetValue(keyID, row.BlockID).Text.Content != "New" {
				t.Fatalf("daily note was not collected and initialized: %+v", row)
			}
			itemID := row.BlockID
			view.GetValue(keyID, itemID).Text.Content = "Edited"
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				reusedPath, reused, createErr := create()
				if createErr != nil || !reused || reusedPath != p {
					t.Fatalf("daily note was not reused: %s %v %v", reusedPath, reused, createErr)
				}
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if len(view.GetBlockKeyValues().Values) != 1 || view.GetValue(keyID, itemID).Text.Content != "Edited" {
				t.Fatal("reopening daily note duplicated or reset its database row")
			}
		})
	}
}
