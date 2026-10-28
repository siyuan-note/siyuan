// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"strings"
	"testing"
)

func TestExactRefDocTitleContractQuery(t *testing.T) {
	database, boxID := useEncryptedQueryTestDB(t)
	for _, item := range []struct{ id, title, name, typ string }{
		{"a-folded", "target", "", "d"},
		{"b-named", "Another document", "Target", "d"},
		{"c-exact", "Target", "", "d"},
		{"d-duplicate", "Target", "", "d"},
		{"e-unicode", "Äpfel", "", "d"},
		{"f-literal", "a'[%]_\\b", "", "d"},
		{"g-long", strings.Repeat("title", 120), "", "d"},
		{"h-paragraph", "Paragraph", "", "p"},
	} {
		if _, err := database.Exec("INSERT INTO blocks (id, content, name, type) VALUES (?, ?, ?, ?)", item.id, item.title, item.name, item.typ); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range []struct{ title, id, rootID, want string }{
		{"Target", "", "", "c-exact"},
		{"TARGET", "", "", "a-folded"},
		{"Target", "c-exact", "d-duplicate", "a-folded"},
		{"Another document", "", "", "b-named"},
		{"äPFEL", "", "", "e-unicode"},
		{"a'[%]_\\b", "", "", "f-literal"},
		{strings.Repeat("title", 120), "", "", "g-long"},
		{"Paragraph", "", "", ""},
		{"missing", "", "", ""},
	} {
		id, err := QueryExactDocTitleIDInBox(item.title, item.id, item.rootID, boxID)
		if err != nil || id != item.want {
			t.Fatalf("title %q: got %q, want %q, error %v", item.title, id, item.want, err)
		}
	}
	t.Run("notebook boundary", func(t *testing.T) {
		otherDB, otherBox := useEncryptedQueryTestDB(t)
		if _, err := otherDB.Exec("INSERT INTO blocks (id, content, type) VALUES ('other', 'Target', 'd')"); err != nil {
			t.Fatal(err)
		}
		if id, err := QueryExactDocTitleIDInBox("Target", "", "", otherBox); err != nil || id != "other" {
			t.Fatalf("notebook boundary changed: %q, %v", id, err)
		}
	})
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := QueryExactDocTitleIDInBox("Target", "", "", boxID); err == nil {
		t.Fatal("database failure treated as an absent title")
	}
}
