// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
)

func TestFlashcardCleanupScansClosedNotebooksAndPreservesUnknown(t *testing.T) {
	root := t.TempDir()
	boxID := "20260101000000-aaaaaaa"
	docID := "20260101000000-bbbbbbb"
	boxDir := filepath.Join(root, boxID)
	if err := os.MkdirAll(filepath.Join(boxDir, ".siyuan"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(path, text string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	confPath := filepath.Join(boxDir, ".siyuan", "conf.json")
	write(confPath, `{"closed":true}`)
	docPath := filepath.Join(boxDir, docID+".sy")
	document := `{"ID":"20260101000000-bbbbbbb","Type":"NodeDocument","Spec":"4","Children":[{"ID":"present","Type":"NodeParagraph"}]}`
	write(docPath, document)
	scan := func(encrypted bool) map[string]flashcardv2.BlockPresence {
		t.Helper()
		ret, err := scanFlashcardBlockPresence(context.Background(), root, []string{"present", "missing"}, func(string) bool { return encrypted })
		if err != nil {
			t.Fatal(err)
		}
		return ret
	}
	if ret := scan(false); ret["present"] != flashcardv2.BlockClosed || ret["missing"] != flashcardv2.BlockMissing {
		t.Fatalf("closed notebook data was mistaken for missing: %+v", ret)
	}
	write(confPath, `{"closed":false}`)
	if ret := scan(false); ret["present"] != flashcardv2.BlockPresent {
		t.Fatalf("reopened notebook: %+v", ret)
	}
	nested := filepath.Join(boxDir, "restored-documents")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(docPath, filepath.Join(nested, filepath.Base(docPath))); err != nil {
		t.Fatal(err)
	}
	docPath = filepath.Join(nested, filepath.Base(docPath))
	if ret := scan(false); ret["present"] != flashcardv2.BlockPresent {
		t.Fatalf("moved document: %+v", ret)
	}
	if ret := scan(true); ret["present"] != flashcardv2.BlockUnknown || ret["missing"] != flashcardv2.BlockUnknown {
		t.Fatalf("encrypted notebook: %+v", ret)
	}
	for _, data := range []string{`invalid`, `{"ID":"20260101000000-bbbbbbb","Type":"NodeDocument","Spec":"999"}`} {
		write(docPath, data)
		if ret := scan(false); ret["missing"] != flashcardv2.BlockUnknown {
			t.Fatalf("unreadable document: %+v", ret)
		}
	}
	write(docPath, document)
	write(confPath, `invalid`)
	if ret := scan(false); ret["missing"] != flashcardv2.BlockUnknown {
		t.Fatalf("invalid configuration: %+v", ret)
	}
}

func TestFlashcardCleanupRejectsFilesChangedDuringScan(t *testing.T) {
	root := t.TempDir()
	boxID := "20260101000000-aaaaaaa"
	boxDir := filepath.Join(root, boxID)
	if err := os.MkdirAll(filepath.Join(boxDir, ".siyuan"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(boxDir, ".siyuan", "conf.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := scanFlashcardBlockPresence(context.Background(), root, []string{"missing"}, func(string) bool {
		if err := os.WriteFile(filepath.Join(boxDir, "20260101000000-bbbbbbb.sy"), []byte(`{}`), 0600); err != nil {
			t.Fatal(err)
		}
		return false
	})
	if err == nil {
		t.Fatal("concurrent restoration did not invalidate scan")
	}
}
