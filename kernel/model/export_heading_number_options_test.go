// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportMarkdownHeadingNumberOptions(t *testing.T) {
	const boxID = "20261108000000-box0001"
	setupMarkdownReferencesTest(t, boxID)
	Conf.Editor.Load().HeadingNumber = true
	Conf.Export.Load().AddTitle = false
	source := newFootnoteTestDoc(t, boxID, "Source")
	disabled := newFootnoteTestDoc(t, boxID, "Disabled")
	disabled.Root.SetIALAttr(headingNumberAttribute, "false")
	var partialID string
	for _, tree := range []*parse.Tree{source, disabled} {
		for _, text := range []string{"First heading", "Second heading"} {
			heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 1}
			heading.SetIALAttr("id", heading.ID)
			heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
			tree.Root.AppendChild(heading)
			if tree == source {
				partialID = heading.ID
			}
		}
		writeAssetDownloadDocumentTest(t, tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	sourcePath := filepath.Join(util.DataDir, boxID, source.Path)
	original, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, persistent := range []bool{true, false} {
		Conf.Export.Load().HeadingNumber = new(persistent)
		for _, choice := range []*bool{new(false), new(true), nil} {
			opts := &ExportOptions{HeadingNumber: choice}
			wantNumber := persistent
			if choice != nil {
				wantNumber = *choice
			}
			_, copied := ExportMarkdownContent(source.ID, opts)
			if strings.Contains(copied, "# 1 First heading") != wantNumber || !strings.Contains(copied, "First heading") {
				t.Fatalf("copy heading option lost: %v %s", choice, copied)
			}
			_, partial := ExportMarkdownContent(partialID, opts)
			if strings.Contains(partial, "# 2 Second heading") != wantNumber || !strings.Contains(partial, "Second heading") {
				t.Fatalf("partial copy lost source numbering: %v %s", choice, partial)
			}
			_, noNumber := ExportMarkdownContent(disabled.ID, opts)
			if strings.Contains(noNumber, "# 1 First heading") || !strings.Contains(noNumber, "First heading") {
				t.Fatalf("request must not enable numbering for a disabled document: %s", noNumber)
			}
			_, zipPath := ExportPandocConvertZipWithOptions([]string{source.ID, disabled.ID}, "", ".md", opts)
			archive := openExportArchive(t, zipPath)
			exported := markdownArchiveDocument(t, archive, "Source")
			if strings.Contains(exported, "# 1 First heading") != wantNumber || !strings.Contains(exported, "First heading") {
				t.Fatalf("archive heading option lost: %v %s", choice, exported)
			}
			if strings.Contains(markdownArchiveDocument(t, archive, "Disabled"), "# 1 First heading") {
				t.Fatal("multi-document archive enabled numbering for a disabled document")
			}
			if *Conf.Export.Load().HeadingNumber != persistent || Conf.Export.Load().MarkdownHeadingNumber != nil {
				t.Fatal("request override changed persistent preference")
			}
			if err := archive.Close(); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, ext := range []string{".docx", ".html", ".pdf"} {
		_, intermediate, _ := exportMarkdownContent(source.ID, markdownExportOptions{Config: resolveExportOptions(nil), Ext: ext})
		if !strings.Contains(intermediate, "# 1 First heading") {
			t.Fatalf("Markdown preference affected %s intermediate: %s", ext, intermediate)
		}
	}
	current, err := os.ReadFile(sourcePath)
	if err != nil || string(current) != string(original) {
		t.Fatalf("export changed the source document: %v", err)
	}
	if Conf.Export.Load().MarkdownHeadingNumber != nil {
		t.Fatal("heading number selection changed persistent defaults")
	}
}
