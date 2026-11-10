// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"fmt"
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func nestedDocumentSource(root string) []byte {
	return []byte(fmt.Sprintf(`{"ID":%q,"Spec":"2","Type":"NodeDocument",
		"Properties":{"id":%q,"title":"Root","updated":"20260701111533"},"Children":[
		{"ID":"20260609092353-ysnx8qo","Spec":"2","Type":"NodeDocument",
		"Properties":{"id":"20260609092353-ysnx8qo","title":"Nested title","type":"doc",
		"custom-test":"保留属性","updated":"20260701091344"},"Children":[
		{"ID":"20260701111533-9bkenzf","Type":"NodeParagraph",
		"Properties":{"id":"20260701111533-9bkenzf"},"Children":[{"Type":"NodeText","Data":"保留正文"}]}]}]}`, root, root))
}

func requireNestedDocumentRepair(t *testing.T, tree *parse.Tree, root string) {
	t.Helper()
	if tree.Root.Type != ast.NodeDocument || tree.ID != root || tree.Root.ID != root {
		t.Fatal("document identity changed")
	}
	nested := tree.Root.FirstChild
	if nested == nil || nested.Type != ast.NodeSuperBlock || nested.ID != "20260609092353-ysnx8qo" ||
		nested.IALAttr("title") != "Nested title" || nested.IALAttr("custom-test") != "保留属性" ||
		nested.IALAttr("updated") != "20260701091344" {
		t.Fatal("nested document attributes changed")
	}
	paragraph := nested.FirstChild.Next.Next
	if nested.FirstChild.Type != ast.NodeSuperBlockOpenMarker || string(nested.FirstChild.Next.Tokens) != "row" ||
		paragraph.Type != ast.NodeParagraph || paragraph.ID != "20260701111533-9bkenzf" ||
		string(paragraph.FirstChild.Tokens) != "保留正文" || paragraph.Next != nested.LastChild ||
		nested.LastChild.Type != ast.NodeSuperBlockCloseMarker {
		t.Fatal("nested document content or markers changed")
	}
}

func TestNestedDocumentReadAndRepair(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprintf("encrypted=%v", encrypted), func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			originalProvider := DEKProvider
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{29}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			t.Cleanup(func() { DEKProvider = originalProvider })
			p := "/" + root + ".sy"
			plain := nestedDocumentSource(root)
			raw, err := encryptDataWithDEK(box, p, plain, dek)
			if err != nil {
				t.Fatal(err)
			}
			abs := writeStalePathFixture(t, box, p, raw)
			engine := util.NewLute()
			fromData, err := LoadTreeByData(plain, box, p, engine)
			if err != nil {
				t.Fatal(err)
			}
			requireNestedDocumentRepair(t, fromData, root)
			snapshot, _, err := ReadTreeSnapshot(box, p)
			if err != nil {
				t.Fatal(err)
			}
			requireNestedDocumentRepair(t, snapshot, root)
			conditional, original, fixed, err := LoadTreeSnapshotWithFix(box, p, engine)
			if err != nil || !fixed || !bytes.Equal(original, raw) {
				t.Fatal("conditional snapshot lost its repair or source", fixed, err)
			}
			requireNestedDocumentRepair(t, conditional, root)
			stored, err := os.ReadFile(abs)
			if err != nil || !bytes.Equal(raw, stored) {
				t.Fatal("read-only repair changed source bytes", err)
			}
			loaded, fixed, err := LoadTreeWithFix(box, p, engine)
			if err != nil || !fixed {
				t.Fatal("file repair failed", fixed, err)
			}
			requireNestedDocumentRepair(t, loaded, root)
			cache.RemoveTreeDataInBox(root, box)
			reloaded, fixed, err := LoadTreeWithFix(box, p, engine)
			if err != nil || fixed {
				t.Fatal("repair did not persist", fixed, err)
			}
			requireNestedDocumentRepair(t, reloaded, root)
			// 保存入口也规范化内存中的嵌套文档，防止再次写入非法结构。
			unfixed, _, err := treenode.ParseJSON(plain, engine.ParseOptions)
			if err != nil {
				t.Fatal(err)
			}
			unfixed.Box, unfixed.Path = box, p
			if _, err = WriteTree(unfixed); err != nil {
				t.Fatal(err)
			}
			requireNestedDocumentRepair(t, unfixed, root)
			stored, err = os.ReadFile(abs)
			if err != nil || (encrypted && !util.IsCiphertext(stored)) {
				t.Fatal("save lost encrypted source", err)
			}
		})
	}
}

func TestNestedDocumentRejectsInvalidSource(t *testing.T) {
	box, root, _, _ := setupStalePathTest(t)
	p := "/" + root + ".sy"
	dek := bytes.Repeat([]byte{37}, 32)
	originalProvider := DEKProvider
	DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
	t.Cleanup(func() { DEKProvider = originalProvider })
	plain := nestedDocumentSource(root)
	ciphertext, err := encryptDataWithDEK(box, p, plain, dek)
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Clone(ciphertext)
	tampered[len(tampered)-1] ^= 1
	future, err := encryptDataWithDEK(box, p, bytes.Replace(plain, []byte(`"Spec":"2"`), []byte(`"Spec":"999"`), 1), dek)
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{"tampered": tampered, "plaintext": plain, "future": future} {
		t.Run(name, func(t *testing.T) {
			abs := writeStalePathFixture(t, box, p, raw)
			for _, read := range []func() error{
				func() error { _, _, err := LoadTreeWithFix(box, p, util.NewLute()); return err },
				func() error { _, _, err := ReadTreeSnapshot(box, p); return err },
				func() error { _, _, err := LoadTreeSnapshot(box, p, util.NewLute()); return err },
			} {
				if err := read(); err == nil {
					t.Fatal("invalid source was accepted")
				}
			}
			stored, err := os.ReadFile(abs)
			if err != nil || !bytes.Equal(raw, stored) {
				t.Fatal("invalid source was changed", err)
			}
		})
	}
}
