// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const testFileAnnotationID = "20260912000000-annotat"

func newFileAnnotationTestNode(reference string) *ast.Node {
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "20260912000000-block01"}
	node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref",
		TextMarkFileAnnotationRefID: reference, TextMarkTextContent: "anchor"}
	paragraph.AppendChild(node)
	return node
}

func writeFileAnnotationTestAsset(t *testing.T, assetPath string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath+".sya", data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestFileAnnotationExport(t *testing.T) {
	oldWorkspace, oldDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = oldWorkspace, oldDataDir })
	for _, test := range []struct{ path, name string }{
		{"a.pdf", "a.pdf"}, {"document.pdf", "document.pdf"}, {"文档.PDF", "文档.PDF"},
		{"folder/document.pdf", "folder/document.pdf"}, {"a%20b.pdf", "a%20b.pdf"}, {"a&copy;.pdf", "a&copy;.pdf"},
		{"a-20260912000001-abcdefg.pdf", "a.pdf"}, {"a-20260912000001-abcdef.pdf", "a-20260912000001-abcdef.pdf"},
	} {
		for _, query := range []string{"", "?dataPath=/docs/a%20b.sy&key=a%26b"} {
			assetLink := "assets/" + test.path
			assetPath := filepath.Join(util.DataDir, "assets", test.path)
			if test.path == "a%20b.pdf" {
				assetPath = filepath.Join(util.DataDir, "assets", "a b.pdf")
			}
			for _, data := range []string{`{"` + testFileAnnotationID + `":{"pages":[{"index":2}]}}`,
				`{"` + testFileAnnotationID + `":{"page":2}}`} {
				writeFileAnnotationTestAsset(t, assetPath, []byte(data))
				for _, mode := range []int{0, 1} {
					node := newFileAnnotationTestNode(assetLink + "/" + testFileAnnotationID + query)
					if err := processFileAnnotationRef(node.TextMarkFileAnnotationRefID, node, mode, ""); err != nil {
						t.Fatalf("export %q: %v", assetLink+query, err)
					}
					link := node.Previous
					wantText := "anchor"
					if mode == 0 {
						wantText = test.name + " - p3 - anchor"
					}
					if link == nil || link.ChildByType(ast.NodeLinkText).TokensStr() != wantText ||
						link.ChildByType(ast.NodeLinkDest).TokensStr() != assetLink+query+"#page=3" {
						t.Fatalf("incorrect export for %q", assetLink+query)
					}
				}
			}
		}
	}
}

func TestFileAnnotationAssetCollection(t *testing.T) {
	const query = "?box=20260912000000-hijklmn&dataPath=/docs/a.sy"
	for _, suffix := range []string{"", query} {
		link := "assets/document.pdf"
		ref := link + "/" + testFileAnnotationID + suffix
		for _, node := range []*ast.Node{
			{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref", TextMarkFileAnnotationRefID: ref},
			{Type: ast.NodeFileAnnotationRefID, Tokens: []byte(ref)},
		} {
			if got := getAssetsLinkDests(node, false); !reflect.DeepEqual(got, []string{link + suffix}) {
				t.Fatalf("resource collection lost parameters: %v", got)
			}
		}
	}
}

func TestFileAnnotationExportEncryptedCompatibility(t *testing.T) {
	const boxID = "20260912000000-annobox"
	cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
	defer cleanup()
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	defer func() { util.WorkspaceDir = oldWorkspace }()
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	const diskName = "a.pdf"
	assetPath := filepath.Join(util.DataDir, boxID, "assets", diskName)
	plaintext := []byte(`{"` + testFileAnnotationID + `":{"pages":[{"index":0}]}}`)
	current, err := EncryptAsset(boxID, diskName+".sya", diskName+".sya", dek, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	legacy := legacyEncryptedAssetFixture(t, boxID, diskName+".sya", diskName+".sya", dek, plaintext)
	for _, ciphertext := range [][]byte{legacy, current} {
		writeFileAnnotationTestAsset(t, assetPath, ciphertext)
		reference := "assets/" + diskName + "/" + testFileAnnotationID + "?box=" + boxID + "&dataPath=/docs/a.sy"
		node := newFileAnnotationTestNode(reference)
		if err = processFileAnnotationRef(reference, node, 0, boxID); err != nil || node.Previous == nil {
			t.Fatalf("authenticated annotation export failed: %v", err)
		}
		if err = processFileAnnotationRef(reference, newFileAnnotationTestNode(reference), 0, "20260912000000-otherbx"); err == nil {
			t.Fatal("cross-notebook annotation reference was accepted")
		}
		for _, invalid := range [][]byte{plaintext, append([]byte(nil), ciphertext...)} {
			if !bytes.Equal(invalid, plaintext) {
				invalid[len(invalid)-5] ^= 1
			}
			writeFileAnnotationTestAsset(t, assetPath, invalid)
			node = newFileAnnotationTestNode(reference)
			if err = processFileAnnotationRef(reference, node, 0, boxID); err == nil || node.Previous != nil {
				t.Fatal("unauthenticated annotation produced export output")
			}
			actual, readErr := os.ReadFile(assetPath + ".sya")
			if readErr != nil || !bytes.Equal(actual, invalid) {
				t.Fatal("failed annotation export changed the source")
			}
		}
	}
	writeFileAnnotationTestAsset(t, assetPath, current)
	cachedDEKsLock.Lock()
	zeroAndClear(cachedDEKs[boxID])
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	reference := "assets/a.pdf/" + testFileAnnotationID + "?box=" + boxID
	if err = processFileAnnotationRef(reference, newFileAnnotationTestNode(reference), 0, boxID); err == nil {
		t.Fatal("locked notebook annotation was exported")
	}
}

func TestFileAnnotationExportRejectsInvalidData(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	t.Cleanup(func() { Conf = originalConf })
	oldWorkspace, oldDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = oldWorkspace, oldDataDir })
	for _, data := range []string{"invalid", "{}", `{"` + testFileAnnotationID + `":{"pages":[]}}`,
		`{"` + testFileAnnotationID + `":{"pages":[{"index":-1}]}}`} {
		writeFileAnnotationTestAsset(t, filepath.Join(util.DataDir, "assets/a.pdf"), []byte(data))
		node := newFileAnnotationTestNode("assets/a.pdf/" + testFileAnnotationID)
		root := &ast.Node{Type: ast.NodeDocument, ID: "20260912000000-root001"}
		root.AppendChild(node.Parent)
		tree := &parse.Tree{Root: root, ID: root.ID}
		if _, err := exportTree(tree, false, false, false, false, 0, 0, 0, "#", "#", "", "", false, "", false, false, true); err == nil {
			t.Fatalf("invalid annotation data exported: %s", data)
		}
		if node.Parent == nil || node.Previous != nil {
			t.Fatal("failed export removed the annotation reference")
		}
	}
}
