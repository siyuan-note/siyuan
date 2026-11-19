// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestParseStdMdUTF8BOM(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n"} {
		for _, prefix := range []string{"", "\xef\xbb\xbf"} {
			for _, metadata := range []bool{false, true} {
				source := "# Title\n\nBody\ufefftext\n"
				if metadata {
					source = "---\ntitle: Note\ntags: [index, personal]\n---\n\n" + source
				}
				tree, _, title, _ := parseStdMd([]byte(prefix+strings.ReplaceAll(source, "\n", newline)), false)
				if heading := tree.Root.ChildByType(ast.NodeHeading); heading == nil || heading.Text() != "Title" {
					t.Fatalf("first heading lost: BOM=%v metadata=%v newline=%q", prefix != "", metadata, newline)
				}
				if body := tree.Root.ChildByType(ast.NodeParagraph); body == nil || body.Text() != "Body\ufefftext" {
					t.Fatal("body text or embedded BOM changed")
				}
				if metadata && (title != "Note" || tree.Root.IALAttr("tags") != "index,personal" || tree.Root.FirstChild.Type != ast.NodeCodeBlock) {
					t.Fatalf("front matter lost: %q %v", title, tree.Root.KramdownIAL)
				}
			}
		}
	}
}

func TestObsidianUTF8BOM(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n"} {
		for _, metadata := range []bool{false, true} {
			root := newObsidianTestDir(t)
			if err := os.Mkdir(filepath.Join(root, ".obsidian"), 0755); err != nil {
				t.Fatal(err)
			}
			source := "# Title\n\n[[#Title]]\n"
			if metadata {
				source = "---\ntitle: Note\ntags: [index, personal]\nsummary: '[[#Title]]'\n---\n\n" + source
			}
			source = "\xef\xbb\xbf" + strings.ReplaceAll(source, "\n", newline)
			if err := os.WriteFile(filepath.Join(root, "Note.md"), []byte(source), 0644); err != nil {
				t.Fatal(err)
			}
			vault, err := analyzeObsidianVault(context.Background(), root, func(int, string) {})
			if err != nil {
				t.Fatal(err)
			}
			doc := vault.DocsByRel[obsidianPathKey("Note")]
			data, err := readStableObsidianFile(doc.Source)
			if err != nil {
				t.Fatal(err)
			}
			transformed, stats := transformObsidianMarkdown(vault, doc, data)
			tree, err := parseObsidianMd(transformed, vault, doc, stats)
			if err != nil {
				t.Fatal(err)
			}
			resolved := resolveObsidianTarget(vault, doc, "#Title")
			heading := treenode.GetNodeInTree(tree, resolved.ID)
			if resolved.Status != "resolved" || heading == nil || heading.Type != ast.NodeHeading || heading.Text() != "Title" {
				t.Fatalf("BOM heading target lost: %+v", resolved)
			}
			if metadata {
				code := tree.Root.FirstChild.ChildByType(ast.NodeCodeBlockCode)
				if tree.Root.IALAttr("tags") != "index,personal" || code == nil || !strings.Contains(code.TokensStr(), "summary: '[[#Title]]'") {
					t.Fatal("front matter was lost or transformed as body text")
				}
			}
			stored, err := os.ReadFile(doc.Source.AbsPath)
			if err != nil || string(stored) != source {
				t.Fatal("import changed the source file")
			}
		}
	}
}
