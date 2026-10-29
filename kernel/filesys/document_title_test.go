// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTitleEncryptedLegacyReadAndAuthentication(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/document-title-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	originalDir, originalProvider := util.DataDir, DEKProvider
	originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
	util.DataDir = t.TempDir()
	dek := bytes.Repeat([]byte{41}, 32)
	DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
	DEKLockAcquire, DEKLockRelease = nil, nil
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir, DEKProvider = originalDir, originalProvider
		DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
	})
	boxID, documentPath := "20261023000000-box0001", "/20261023000000-title01.sy"
	writeStalePathFixture(t, boxID, documentaddressing.ConfigPath, []byte(`{"documentAddressingVersion":2}`))
	filename := filepath.Join(util.DataDir, boxID, documentPath)
	if err = os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		t.Fatal(err)
	}
	writeEncrypted := func(plain []byte) []byte {
		t.Helper()
		ciphertext, err := encryptDataWithDEK(boxID, documentPath, plain, dek)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filename, ciphertext, 0600); err != nil {
			t.Fatal(err)
		}
		cache.ClearTreeCache()
		return ciphertext
	}
	writeEncrypted(legacy)
	luteEngine := util.NewLute()
	tree, err := LoadTree(boxID, documentPath, luteEngine)
	if err != nil || tree.Root.DocumentTitle != nil || tree.Root.Spec != "6" || tree.Root.IALAttr("title") != "Legacy/A **literal**" {
		t.Fatalf("supported encrypted source reinterpreted: %v", err)
	}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong a", TextMarkTextContent: "Title/A", TextMarkAHref: "assets/original.pdf"})
	if err = treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
		t.Fatal(err)
	}
	treenode.UpgradeSpec(tree)
	source := tree.Root.DocumentTitle.Content
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	writeEncrypted(data)
	restored, err := LoadTree(boxID, documentPath, luteEngine)
	if err != nil || restored.Root.DocumentTitle == nil || restored.Root.DocumentTitle.Content != source || restored.Root.FirstChild.Text() != "Original body" {
		t.Fatalf("authenticated title source roundtrip failed: %v", err)
	}
	for _, invalid := range []*ast.DocumentTitle{{Spec: 99, Format: "inline-ast", Content: "[]"}, {Spec: 1, Format: "future", Content: "private"}} {
		tree.Root.DocumentTitle = invalid
		ciphertext := writeEncrypted(render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render())
		if _, err = LoadTree(boxID, documentPath, luteEngine); err == nil {
			t.Fatal("invalid encrypted title source accepted")
		}
		retained, err := os.ReadFile(filename)
		if err != nil || !bytes.Equal(retained, ciphertext) {
			t.Fatal("rejected authenticated source was overwritten")
		}
	}
	ciphertext := writeEncrypted(data)
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(filename, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearTreeCache()
	if _, err = LoadTree(boxID, documentPath, luteEngine); err == nil {
		t.Fatal("authentication failure accepted")
	}
	retained, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(retained, ciphertext) {
		t.Fatal("authentication failure overwrote ciphertext")
	}
}
