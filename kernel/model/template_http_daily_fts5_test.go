// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplateHTTPDailyNoteConfirmsOutsideCreationLock(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	boxConf := fixture.box.GetConf()
	boxConf.DailyNoteSavePath = "/HTTP Daily"
	boxConf.DailyNoteTemplatePath = "/http-daily.md"
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "http-daily.md"), []byte(`.action{(httpGet "https://example.com/weather").error}`), 0644); err != nil {
		t.Fatal(err)
	}
	confirmations := 0
	execution := templatehttp.New(context.Background(), fixture.box.ID, func(context.Context, templatehttp.Request) bool {
		confirmations++
		if !createDocLock.TryLock() {
			t.Error("confirmation held document creation lock")
		} else {
			createDocLock.Unlock()
		}
		return false
	})
	defer execution.Close()
	date := time.Date(2026, 10, 30, 0, 0, 0, 0, time.Local)
	p, existed, err := CreateDailyNoteWithHTTP(fixture.box.ID, &date, execution)
	if err != nil || existed || confirmations != 1 {
		t.Fatalf("daily template: %s %t %d %v", p, existed, confirmations, err)
	}
	tree, err := LoadTreeByBlockID(util.GetTreeID(p))
	if err != nil || tree.Root.Text() != "denied" {
		t.Fatalf("daily fallback missing: %v %v", tree, err)
	}
	if _, existed, err = CreateDailyNoteWithHTTP(fixture.box.ID, &date, execution); err != nil || !existed || confirmations != 1 {
		t.Fatalf("daily reopen reran template: %v %t %d", err, existed, confirmations)
	}
}
