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
	"time"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDailyNoteReuseAcrossEntryPoints(t *testing.T) {
	for _, change := range []string{"rename", "move"} {
		t.Run(change, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			boxConf := fixture.box.GetConf()
			boxConf.DailyNoteSavePath = "/Daily notes/Today"
			if err := fixture.box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}

			date := time.Now()
			originalPath, existed, err := CreateDailyNote(fixture.box.ID)
			if err != nil || existed {
				t.Fatalf("create initial daily note: %s %v %v", originalPath, existed, err)
			}
			originalID := util.GetTreeID(originalPath)
			if change == "rename" {
				if err = RenameDoc(fixture.box.ID, originalPath, "Daily summary"); err != nil {
					t.Fatal(err)
				}
			} else {
				if err = MoveDocs([]string{fixture.box.ID + originalPath}, fixture.box.ID, "/", nil); err != nil {
					t.Fatal(err)
				}
				originalPath = "/" + originalID + ".sy"
			}

			readSource := func(id string) []byte {
				t.Helper()
				tree, loadErr := LoadTreeByBlockID(id)
				if loadErr != nil {
					t.Fatal(loadErr)
				}
				data, readErr := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
				if readErr != nil {
					t.Fatal(readErr)
				}
				return data
			}
			assertDateTarget := func(wantID string) {
				t.Helper()
				info, infoErr := GetDailyNoteInfo(fixture.box.ID, date)
				if infoErr != nil || info == nil || !info.Existed || info.ID != wantID {
					t.Fatalf("date preview: got %+v (%v), want %s", info, infoErr, wantID)
				}
				p, reused, createErr := CreateDailyNoteAt(fixture.box.ID, date)
				if createErr != nil || !reused || util.GetTreeID(p) != wantID {
					t.Fatalf("dated entry: got %s %v (%v), want %s", p, reused, createErr, wantID)
				}
			}

			// 日期入口仍定位改名或移动后的日记，普通入口则按模板补建缺失目标。
			originalSource := readSource(originalID)
			assertDateTarget(originalID)
			targetPath, reused, err := CreateDailyNote(fixture.box.ID)
			if err != nil || reused || util.GetTreeID(targetPath) == originalID {
				t.Fatalf("ordinary entry did not create its missing template target: %s %v %v", targetPath, reused, err)
			}
			targetID := util.GetTreeID(targetPath)
			targetSource := readSource(targetID)

			// 已有目标不重新应用正文模板，即使当前配置指向一个不存在的模板。
			boxConf.DailyNoteTemplatePath = "/missing-body-template.md"
			if err = fixture.box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				assertDateTarget(targetID)
				p, reused, createErr := CreateDailyNote(fixture.box.ID)
				if createErr != nil || !reused || p != targetPath {
					t.Fatalf("ordinary entry did not reuse its template target: %s %v %v", p, reused, createErr)
				}
			}
			if !bytes.Equal(originalSource, readSource(originalID)) || !bytes.Equal(targetSource, readSource(targetID)) {
				t.Fatal("alternating daily-note entries changed an existing source")
			}

			// 两篇同日期日记均不匹配新模板目标时，日期入口按 ID 升序选择，且不创建缺失目标。
			boxConf.DailyNoteSavePath = "/Another location/Today"
			if err = fixture.box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			wantIDs := []string{originalID, targetID}
			slices.Sort(wantIDs)
			assertDateTarget(wantIDs[0])
			sql.FlushQueue()
			ids, err := sql.QueryDailyNoteRootIDsInBox(fixture.box.ID, DailyNoteAttrPrefix+date.Format("20060102"), date.Format("20060102"))
			if err != nil || !slices.Equal(ids, wantIDs) {
				t.Fatalf("unexpected daily-note documents: %v (%v), want %v", ids, err, wantIDs)
			}
			if !bytes.Equal(originalSource, readSource(originalID)) || !bytes.Equal(targetSource, readSource(targetID)) {
				t.Fatal("date fallback changed an existing source")
			}
		})
	}
}
