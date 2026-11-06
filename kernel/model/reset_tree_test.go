// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestResetTreeTitleAndHPath(t *testing.T) {
	originalConf := Conf
	const testLang = "reset-tree-test"
	originalLang, hadLang := util.Langs[testLang]
	util.Langs[testLang] = map[int]string{16: "Untitled"}
	Conf = NewAppConf()
	Conf.Lang = testLang
	t.Cleanup(func() {
		Conf = originalConf
		if hadLang {
			util.Langs[testLang] = originalLang
		} else {
			delete(util.Langs, testLang)
		}
	})
	for _, test := range []struct {
		name   string
		title  string
		suffix string
		empty  bool
		rich   bool
	}{
		{name: "duplicate", title: "Example", suffix: "Duplicated"},
		{name: "conflict", title: "Example", suffix: "Conflicted"},
		{name: "reset without suffix", title: "Example"},
		{name: "named placeholder", title: Conf.language(16), suffix: "Duplicated"},
		{name: "empty from another language", title: "Historical placeholder", suffix: "Duplicated", empty: true},
		{name: "legacy empty", title: "", suffix: "Duplicated"},
		{name: "rich duplicate", title: "Example", suffix: "Duplicated", rich: true},
		{name: "rich conflict", title: "Example", suffix: "Conflicted", rich: true},
		{name: "preserve title spaces", title: "Example  Document ", suffix: "Duplicated"},
	} {
		for _, parent := range []string{"", "/Parent"} {
			t.Run(test.name+parent, func(t *testing.T) {
				docPath := "/20261004000001-doc0001.sy"
				if parent != "" {
					docPath = "/20261004000000-parent1" + docPath
				}
				tree := treenode.NewTree("20261004000000-box0001", docPath, parent+"/"+test.title, test.title)
				if test.empty {
					tree.Root.SetIALAttr(treenode.DocumentTitleEmptyAttr, "true")
				}
				if test.rich {
					paragraph := &ast.Node{Type: ast.NodeParagraph}
					paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: test.title})
					if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
						t.Fatal(err)
					}
				}
				if err := resetTree(tree, test.suffix, false); err != nil {
					t.Fatal(err)
				}
				if err := treenode.RefreshDocumentTitle(tree.Root); err != nil {
					t.Fatal(err)
				}
				title := tree.Root.IALAttr("title")
				if tree.HPath != parent+"/"+title {
					t.Fatalf("title and path disagree: title=%q, hpath=%q", title, tree.HPath)
				}
				if test.suffix == "" || test.empty || test.title == "" {
					if title != test.title {
						t.Fatalf("unexpected title: %q", title)
					}
				} else if !strings.HasPrefix(title, test.title+" ("+test.suffix+" ") || !strings.HasSuffix(title, ")") {
					t.Fatalf("unexpected suffix: %q", title)
				}
				if test.rich {
					paragraph, err := treenode.DocumentTitleParagraph(tree.Root)
					if err != nil || tree.Root.DocumentTitle == nil || paragraph.FirstChild.TextMarkType != "strong" || treenode.DocumentTitleText(paragraph) != title {
						t.Fatalf("rich title source lost: %v", err)
					}
				}
				if path.Dir(tree.Path) != path.Dir(docPath) || path.Base(tree.Path) != tree.ID+".sy" {
					t.Fatalf("unexpected document path: %q", tree.Path)
				}
			})
		}
	}
}

func TestDuplicateRichTitleSuffixLiteralDOM(t *testing.T) {
	for _, suffix := range []string{" (Duplicated 2026-11-06 07:30:58)", " (Conflicted 2026-11-06 07:30:58)", " (<tag> & text)"} {
		tree := treenode.NewTree("box", "/20261004000001-doc0001.sy", "/Original", "Original")
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "em", TextMarkTextContent: "Original"})
		if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
		if err := appendDuplicateDocumentTitle(tree.Root, suffix); err != nil {
			t.Fatal(err)
		}
		paragraph, err := treenode.DocumentTitleParagraph(tree.Root)
		if err != nil {
			t.Fatal(err)
		}
		if got := treenode.DocumentTitleText(paragraph); got != "Original"+suffix {
			t.Fatalf("literal suffix changed: %q", got)
		}
		engine := util.NewLute()
		fragment := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Context: &parse.Context{ParseOption: engine.ParseOptions}}
		fragment.Root.AppendChild(paragraph)
		dom := engine.Tree2BlockDOM(fragment, engine.RenderOptions, engine.ParseOptions)
		if strings.Contains(dom, `data-type="backslash"`) || strings.Contains(dom, "<tag>") {
			t.Fatalf("suffix escaped or interpreted as HTML: %s", dom)
		}
		if !strings.Contains(dom, `data-type="em"`) {
			t.Fatalf("title formatting lost: %s", dom)
		}
	}
}

func TestResetTreeRejectsInvalidTitleWithoutResettingIdentity(t *testing.T) {
	tree := treenode.NewTree("box", "/20261004000001-doc0001.sy", "/Original", "Original")
	tree.Root.DocumentTitle = &ast.DocumentTitle{Spec: 99, Format: "inline-ast", Content: "[]"}
	id, p := tree.ID, tree.Path
	if err := resetTreeData(tree, "Duplicated", false); err == nil {
		t.Fatal("invalid title source accepted")
	}
	if tree.ID != id || tree.Path != p || tree.Root.IALAttr("title") != "Original" {
		t.Fatal("failed duplication changed source identity or title")
	}
}
