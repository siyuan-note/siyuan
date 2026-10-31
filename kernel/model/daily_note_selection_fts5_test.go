// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDailyNoteAncestorSelection(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	first := newHPathTestDoc(t, fixture.box.ID, "/", "daily note", 1)
	newHPathTestDoc(t, fixture.box.ID, "/", "daily note", 1)
	config := fixture.box.GetConf()
	config.DailyNoteSavePath = `/daily note/{{now | date "2006/01"}}/{{now | date "2006-01-02" }} W{{ISOWeek now}}周{{WeekdayCN now}}`
	config.DailyNoteTemplatePath = "/selected-daily.md"
	if err := fixture.box.SaveConf(config); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "selected-daily.md"), []byte(`.action{now | date "2006-01-02"} .action{(httpGet "https://example.com/weather").error}`), 0644); err != nil {
		t.Fatal(err)
	}
	confirmations := 0
	execution := templatehttp.New(context.Background(), fixture.box.ID, func(context.Context, templatehttp.Request) bool {
		confirmations++
		if !createDocLock.TryLock() {
			t.Error("confirmation held creation lock")
		} else {
			createDocLock.Unlock()
		}
		return false
	})
	defer execution.Close()
	date := time.Date(2026, 10, 31, 0, 0, 0, 0, time.Local)
	_, _, err := CreateDailyNoteWithSelection(fixture.box.ID, &date, execution, nil)
	var ambiguity *DocumentAncestorAmbiguity
	if !errors.As(err, &ambiguity) || ambiguity.Title != "daily note" || confirmations != 0 {
		t.Fatalf("expected pre-write ambiguity: %v", err)
	}
	info, err := GetDailyNoteInfo(fixture.box.ID, date)
	if err != nil || info.Existed || info.Title != "2026-10-31 W44周六" {
		t.Fatalf("date hint disappeared: %+v %v", info, err)
	}
	parent, err := getDocumentPath(fixture.box.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	selection := &DocumentSelection{Time: ambiguity.Time, TargetRevision: ambiguity.TargetRevision,
		AncestorChoices: []DocumentAncestorChoice{{Index: ambiguity.Index, ID: first.ID, Revision: parent.Revision}}}
	p, existed, err := CreateDailyNoteWithSelection(fixture.box.ID, &date, execution, selection)
	if err != nil || existed || confirmations != 1 {
		t.Fatalf("selected daily creation failed: %s %t %v", p, existed, err)
	}
	tree, err := LoadTreeByBlockID(util.GetTreeID(p))
	if err != nil || tree.Root.IALAttr(DailyNoteAttrPrefix+"20261031") != "20261031" || tree.Root.Text() != "2026-10-31 denied" {
		t.Fatalf("daily semantics changed: %+v %v", tree, err)
	}
	newHPathTestDoc(t, fixture.box.ID, path.Dir(p), "2026-10-31 W44周六", 1)
	_, _, err = CreateDailyNoteWithSelection(fixture.box.ID, nil, execution, selection)
	if !errors.As(err, &ambiguity) || ambiguity.Index != 3 {
		t.Fatalf("reuse ambiguity missing: %v", err)
	}
	chosen, err := getDocumentPath(fixture.box.ID, tree.ID)
	if err != nil {
		t.Fatal(err)
	}
	selection.AncestorChoices = append(selection.AncestorChoices, DocumentAncestorChoice{Index: 3, ID: tree.ID, Revision: chosen.Revision})
	for range 2 {
		reused, reusedExisting, reuseErr := CreateDailyNoteWithSelection(fixture.box.ID, nil, execution, selection)
		if reuseErr != nil || !reusedExisting || reused != p || confirmations != 1 {
			t.Fatalf("reuse reran template: %s %t %v", reused, reusedExisting, reuseErr)
		}
	}
	info, err = GetDailyNoteInfo(fixture.box.ID, date)
	if err != nil || !info.Existed || info.ID != tree.ID {
		t.Fatalf("dated reuse ignored existing note: %+v %v", info, err)
	}
	wrongDate := date.AddDate(0, 0, 1)
	if _, _, err = CreateDailyNoteWithSelection(fixture.box.ID, &wrongDate, nil, selection); err == nil {
		t.Fatal("selection changed target date")
	}
	config.DailyNoteSavePath = "/Changed/Daily"
	if err = fixture.box.SaveConf(config); err != nil {
		t.Fatal(err)
	}
	if _, _, err = CreateDailyNoteWithSelection(fixture.box.ID, &date, nil, selection); err == nil {
		t.Fatal("changed daily target accepted")
	}
}
