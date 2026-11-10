// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkdownArchiveIncludesImagesAfterLiteralFence(t *testing.T) {
	const boxID = "20261109000000-box0001"
	setupMarkdownReferencesTest(t, boxID)
	Conf.Export.Load().AddTitle, Conf.Export.Load().RemoveAssetsID = false, false
	source := newFootnoteTestDoc(t, boxID, "LiteralFences")
	source.Root.FirstChild.Unlink()
	content := literalFenceTestTree("```")
	for content.Root.FirstChild != nil {
		source.Root.AppendChild(content.Root.FirstChild)
	}
	assets := getAssetsLinkDests(source.Root, false)
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, asset := range assets {
		if err := os.WriteFile(filepath.Join(util.DataDir, asset), []byte("fixture "+asset), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeAssetDownloadDocumentTest(t, source)
	sql.IndexTreeQueue(source)
	sql.FlushQueue()
	_, zipPath := ExportPandocConvertZipWithOptions([]string{source.ID}, "", ".md", &ExportOptions{})
	archive := openExportArchive(t, zipPath)
	defer archive.Close()
	for _, asset := range assets {
		found := false
		for _, file := range archive.File {
			if file.Name != asset {
				continue
			}
			r, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(r)
			r.Close()
			if err != nil || string(data) != "fixture "+asset {
				t.Fatalf("asset %s changed: %q, %v", asset, data, err)
			}
			found = true
		}
		if !found {
			t.Fatalf("archive is missing %s", asset)
		}
	}
	markdown := markdownArchiveDocument(t, archive, "LiteralFences")
	parsed := parse.Parse("", []byte(markdown), NewLute().ParseOptions)
	if got := getAssetsLinkDests(parsed.Root, false); len(got) != 2 || parsed.Root.ChildByType(ast.NodeHeading) == nil ||
		!strings.Contains(markdown, "original();") {
		t.Fatalf("exported Markdown lost following content: %s", markdown)
	}
}
