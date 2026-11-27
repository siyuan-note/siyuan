// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	scan := func() map[string]flashcardv2.BlockPresence {
		t.Helper()
		ret, err := scanFlashcardBlockPresence(context.Background(), root, []string{"present", "missing"}, func(string) bool { return false })
		if err != nil {
			t.Fatal(err)
		}
		return ret
	}
	if ret := scan(); ret["present"] != flashcardv2.BlockClosed || ret["missing"] != flashcardv2.BlockMissing {
		t.Fatalf("closed notebook data was mistaken for missing: %+v", ret)
	}
	write(confPath, `{"closed":false}`)
	if ret := scan(); ret["present"] != flashcardv2.BlockPresent {
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
	if ret := scan(); ret["present"] != flashcardv2.BlockPresent {
		t.Fatalf("moved document: %+v", ret)
	}
	for _, data := range []string{`invalid`, `{"ID":"20260101000000-bbbbbbb","Type":"NodeDocument","Spec":"999"}`} {
		write(docPath, data)
		if ret := scan(); ret["missing"] != flashcardv2.BlockUnknown {
			t.Fatalf("unreadable document: %+v", ret)
		}
	}
	write(docPath, document)
	write(confPath, `invalid`)
	if ret := scan(); ret["missing"] != flashcardv2.BlockUnknown {
		t.Fatalf("invalid configuration: %+v", ret)
	}
}

func TestFlashcardCleanupSkipsEncryptedNotebooksAndScansCurrentDocumentSpecs(t *testing.T) {
	root := t.TempDir()
	write := func(boxID, name, content string) {
		t.Helper()
		path := filepath.Join(root, boxID, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	plainBox := "20260101000000-plainxx"
	uncertainBox := "20260101000000-runtimx"
	diskEncryptedBox := "20260101000000-diskxxx"
	write(plainBox, ".siyuan/conf.json", `{}`)
	write(plainBox, "20260101000000-bbbbbbb.sy", `{
		"ID":"20260101000000-bbbbbbb","Type":"NodeDocument","Spec":"5",
		"Children":[{"Type":"NodeMindmap","Children":[{"Type":"NodeMindmapItem","ID":"mapItem"}]}]
	}`)
	write(plainBox, "20260101000000-ccccccc.sy", `{
		"ID":"20260101000000-ccccccc","Type":"NodeDocument","Spec":"6",
		"Properties":{"title":"Subject/topic"},
		"Children":[{"Type":"NodeParagraph","ID":"legacyTitleBody"}]
	}`)
	write(plainBox, "20260101000000-ddddddd.sy", `{
		"ID":"20260101000000-ddddddd","Type":"NodeDocument","Spec":"7",
		"DocumentTitle":{"spec":1,"format":"inline-ast","content":"[{\"Type\":\"NodeText\",\"Data\":\"Subject\"}]"},
		"Children":[{"Type":"NodeParagraph","ID":"richTitleBody"}]
	}`)
	write(diskEncryptedBox, ".siyuan/conf.json", `{"encrypted":true}`)
	write(diskEncryptedBox, "20260101000000-fffffff.sy", `ciphertext`)
	isEncrypted := func(id string) bool { return id == uncertainBox }
	ret, err := scanFlashcardBlockPresence(context.Background(), root,
		[]string{"mapItem", "legacyTitleBody", "richTitleBody", "missing"}, isEncrypted)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"mapItem", "legacyTitleBody", "richTitleBody"} {
		if ret[id] != flashcardv2.BlockPresent {
			t.Errorf("document body block %s: %+v", id, ret)
		}
	}
	if ret["missing"] != flashcardv2.BlockMissing {
		t.Errorf("encrypted notebooks prevented a missing result: %+v", ret)
	}
	write(uncertainBox, ".siyuan/conf.json", `{}`)
	ret, err = scanFlashcardBlockPresence(context.Background(), root, []string{"missing"}, isEncrypted)
	if err != nil || ret["missing"] != flashcardv2.BlockUnknown {
		t.Fatalf("notebook with uncertain encryption identity: %+v, %v", ret, err)
	}
	write(uncertainBox, ".siyuan/conf.json", `{"boxCrypt":{}}`)
	ret, err = scanFlashcardBlockPresence(context.Background(), root, []string{"missing"}, func(string) bool { return false })
	if err != nil || ret["missing"] != flashcardv2.BlockUnknown {
		t.Fatalf("notebook with incomplete encryption metadata: %+v, %v", ret, err)
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
	checks := 0
	_, err := scanFlashcardBlockPresence(context.Background(), root, []string{"missing"}, func(string) bool {
		checks++
		if checks == 2 {
			if err := os.WriteFile(filepath.Join(boxDir, "20260101000000-bbbbbbb.sy"), []byte(`{}`), 0600); err != nil {
				t.Fatal(err)
			}
		}
		return false
	})
	if err == nil {
		t.Fatal("concurrent restoration did not invalidate scan")
	}
}
