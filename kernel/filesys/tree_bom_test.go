// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeUTF8BOM(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprintf("encrypted=%v", encrypted), func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			originalProvider := DEKProvider
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{17}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			t.Cleanup(func() { DEKProvider = originalProvider })
			p := "/" + root + ".sy"
			engine := util.NewLute()
			tree := treenode.NewTree(box, p, "/Parent", "Parent")
			tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("before\xef\xbb\xbfafter")})
			data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
			plain := append([]byte("\xef\xbb\xbf"), data...)
			raw, err := encryptDataWithDEK(box, p, plain, dek)
			if err != nil {
				t.Fatal(err)
			}
			abs := writeStalePathFixture(t, box, p, raw)
			assertUnchanged := func() {
				t.Helper()
				got, readErr := os.ReadFile(abs)
				if readErr != nil || !bytes.Equal(raw, got) {
					t.Fatalf("read-only operation changed source: %v", readErr)
				}
			}
			if loaded, loadErr := LoadTreeByData(plain, box, p, engine); loadErr != nil || loaded.Root.ID != root {
				t.Fatalf("BOM data not readable: %v", loadErr)
			}
			if ial, readErr := DocIAL(abs); readErr != nil || ial["title"] != "Parent" {
				t.Fatalf("BOM properties not readable: %v, %v", ial, readErr)
			}
			if _, _, readErr := ReadTreeSnapshot(box, p); readErr != nil {
				t.Fatalf("BOM read-only snapshot failed: %v", readErr)
			}
			if _, original, readErr := LoadTreeSnapshot(box, p, engine); readErr != nil || !bytes.Equal(original, raw) {
				t.Fatalf("BOM conditional snapshot lost original bytes: %v", readErr)
			}
			childPath := "/" + root + "/20260912000003-child02.sy"
			child := treenode.NewTree(box, childPath, "/Parent/Child", "Child")
			if _, err = WriteTree(child); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeDataInBox(child.ID, box)
			if loaded, readErr := LoadTree(box, childPath, engine); readErr != nil || loaded.HPath != "/Parent/Child" {
				t.Fatalf("BOM parent not readable: %v", readErr)
			}
			assertUnchanged()
			loaded, fixed, err := LoadTreeWithFix(box, p, engine)
			if err != nil || !fixed || loaded.Root.ID != root {
				t.Fatalf("BOM tree not repaired: fixed=%v err=%v", fixed, err)
			}
			stored, err := os.ReadFile(abs)
			if err != nil {
				t.Fatal(err)
			}
			stored, err = decryptDataWithDEK(box, p, stored, dek)
			if err != nil || !json.Valid(stored) || bytes.HasPrefix(stored, []byte("\xef\xbb\xbf")) {
				t.Fatalf("repaired JSON still contains a BOM: %v", err)
			}
			if !strings.Contains(string(stored), "before\xef\xbb\xbfafter") {
				t.Fatal("BOM inside content was changed")
			}
			cache.RemoveTreeDataInBox(root, box)
			if _, fixed, err = LoadTreeWithFix(box, p, engine); err != nil || fixed {
				t.Fatalf("repair did not persist: fixed=%v err=%v", fixed, err)
			}
		})
	}
}

func TestTreeUTF8BOMRejectsInvalidSource(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for name, data := range map[string][]byte{
			"malformed": []byte("\xef\xbb\xbf{\"Spec\":"),
			"future":    []byte("\xef\xbb\xbf{\"Spec\":\"999\"}"),
			"repeated":  []byte("\xef\xbb\xbf\xef\xbb\xbf{}"),
			"utf16":     {0xff, 0xfe, '{', 0, '}', 0},
		} {
			t.Run(fmt.Sprintf("%s/encrypted=%v", name, encrypted), func(t *testing.T) {
				box, root, _, _ := setupStalePathTest(t)
				originalProvider := DEKProvider
				var dek []byte
				if encrypted {
					dek = bytes.Repeat([]byte{23}, 32)
				}
				DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
				t.Cleanup(func() { DEKProvider = originalProvider })
				p := "/" + root + ".sy"
				raw, err := encryptDataWithDEK(box, p, data, dek)
				if err != nil {
					t.Fatal(err)
				}
				abs := writeStalePathFixture(t, box, p, raw)
				if _, _, err = LoadTreeWithFix(box, p, util.NewLute()); err == nil {
					t.Fatal("invalid source was accepted")
				}
				retained, err := os.ReadFile(abs)
				if err != nil || !bytes.Equal(raw, retained) {
					t.Fatalf("invalid source was changed: %v", err)
				}
			})
		}
	}
}

func TestTreeUTF8BOMDoesNotBypassAuthentication(t *testing.T) {
	box, root, _, _ := setupStalePathTest(t)
	originalProvider := DEKProvider
	dek := bytes.Repeat([]byte{31}, 32)
	DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
	t.Cleanup(func() { DEKProvider = originalProvider })
	p := "/" + root + ".sy"
	engine := util.NewLute()
	tree := treenode.NewTree(box, p, "/Test", "Test")
	plain := append([]byte("\xef\xbb\xbf"), render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()...)
	ciphertext, err := encryptDataWithDEK(box, p, plain, dek)
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Clone(ciphertext)
	tampered[len(tampered)-1] ^= 1
	for name, raw := range map[string][]byte{
		"tampered":          tampered,
		"plaintext":         plain,
		"ciphertext-prefix": append([]byte("\xef\xbb\xbf"), ciphertext...),
	} {
		t.Run(name, func(t *testing.T) {
			abs := writeStalePathFixture(t, box, p, raw)
			for _, read := range []func() error{
				func() error { _, err := LoadTree(box, p, engine); return err },
				func() error { _, _, err := ReadTreeSnapshot(box, p); return err },
				func() error { _, _, err := LoadTreeSnapshot(box, p, engine); return err },
				func() error { _, err := DocIAL(abs); return err },
				func() error { _, _, err := ReadDocHPath(box, p); return err },
			} {
				if err := read(); err == nil {
					t.Fatal("unauthenticated source was accepted")
				}
			}
			retained, err := os.ReadFile(abs)
			if err != nil || !bytes.Equal(retained, raw) {
				t.Fatalf("authentication failure changed source: %v", err)
			}
		})
	}
}
