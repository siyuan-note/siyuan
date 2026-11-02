// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFindReplaceRichDocumentTitle(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testFindReplaceRichDocumentTitle(t, prepareDocumentTitleFeatureBox(t))
}

func testFindReplaceRichDocumentTitle(t *testing.T, boxID string) {
	t.Run("plain title replacement preserves complete literal text", func(t *testing.T) {
		plain := newHPathTestDoc(t, boxID, "/", "Plain", 1)
		text := strings.Repeat("Long literal **text** / ", 40) + "FOO"
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
		if err := treenode.SetDocumentTitleParagraph(plain.Root, paragraph); err != nil {
			t.Fatal(err)
		}
		saveDocumentTitleFeatureTree(t, plain)
		if err := FindReplaceInBox("FOO", "Bar/", map[string]bool{"docTitle": true}, []string{plain.ID}, nil, nil, nil, nil, 0, boxID); err != nil {
			t.Fatal(err)
		}
		loaded, _, err := filesys.LoadTreeSnapshot(boxID, plain.Path, util.NewLute())
		want := strings.ReplaceAll(text, "FOO", "Bar/")
		if err != nil || loaded.Root.DocumentTitle != nil || loaded.Root.IALAttr("title") != want ||
			loaded.Root.FirstChild.ID != plain.Root.FirstChild.ID {
			t.Fatalf("plain replacement changed source or body: %v", err)
		}
	})
	tree := newHPathTestDoc(t, boxID, "/", "Source", 1)
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	paragraph := parse.Parse("", []byte("**FOO** ![FOO](assets/FOO.png) [FOO](https://example.com/FOO) $FOO$"), util.NewLute().ParseOptions).Root.FirstChild
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "FOO", TextMarkInlineMemoContent: "Hidden FOO"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "FOO"})
	if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
		t.Fatal(err)
	}
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("BODY FOO")})
	saveDocumentTitleFeatureTree(t, definition)
	saveDocumentTitleFeatureTree(t, tree)
	before, _ := os.ReadFile(headingConversionPath(tree))
	if err := FindReplaceInBox("FOO", "Bar/", map[string]bool{}, []string{tree.ID}, nil, nil, nil, nil, 0, boxID); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(headingConversionPath(tree))
	if !bytes.Equal(before, after) {
		t.Fatal("disabled document-title replacement changed the source")
	}
	if err := FindReplaceInBox("FOO", "Bar/", map[string]bool{"docTitle": true}, []string{tree.ID}, nil, nil, nil, nil, 0, boxID); err != nil {
		t.Fatal(err)
	}
	loaded, _, err := filesys.LoadTreeSnapshot(boxID, tree.Path, util.NewLute())
	if err != nil || loaded.Root.DocumentTitle == nil || strings.Contains(treenode.ReadDocumentTitle(loaded.Root).Text, "FOO") ||
		!strings.Contains(treenode.ReadDocumentTitle(loaded.Root).Text, "Bar/") || !strings.Contains(loaded.Root.FirstChild.Content(), "BODY FOO") {
		t.Fatal("replacement flattened title source, normalized slash, or changed body", err)
	}
	text, err := treenode.DocumentTitleParagraph(loaded.Root)
	if err != nil {
		t.Fatal(err)
	}
	var image, link, memo, ref bool
	ast.Walk(text, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			image = image || node.Type == ast.NodeLinkDest && string(node.Tokens) == "assets/FOO.png"
			link = link || node.TextMarkAHref == "https://example.com/FOO"
			memo = memo || node.TextMarkInlineMemoContent == "Hidden FOO"
			ref = ref || node.TextMarkBlockRefID == definition.ID && node.TextMarkBlockRefSubtype == "s" && node.TextMarkTextContent == "Bar/"
		}
		return ast.WalkContinue
	})
	if !image || !link || !memo || !ref {
		t.Fatal("replacement changed title inline metadata", image, link, memo, ref)
	}
	if refs := sql.QueryRefsByDefIDInBox(definition.ID, false, boxID); len(refs) != 1 || refs[0].BlockID != tree.ID {
		t.Fatal("replacement lost title backlink ownership")
	}
	var concurrent []byte
	err = findReplaceInBox("Bar/", "Lost", map[string]bool{"docTitle": true}, []string{tree.ID}, nil, nil, nil, nil, 0, boxID, func() {
		loaded.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" CONCURRENT")})
		if _, err := filesys.WriteTree(loaded); err != nil {
			t.Fatal(err)
		}
		concurrent, _ = os.ReadFile(headingConversionPath(tree))
	})
	if !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("replacement did not reject concurrent edit", err)
	}
	current, _ := os.ReadFile(headingConversionPath(tree))
	if !bytes.Equal(current, concurrent) {
		t.Fatal("replacement overwrote concurrent source bytes")
	}
}
