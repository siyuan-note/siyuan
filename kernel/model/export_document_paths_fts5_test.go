// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"path"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
)

func TestExportDocumentPathsArchiveAndReferenceCollisions(t *testing.T) {
	const boxID = "20261023030000-export1"
	setupMarkdownReferencesTest(t, boxID)
	Conf.Export.Load().BlockRefMode = 4
	first := newFootnoteTestDoc(t, boxID, "Twin")
	second := newFootnoteTestDoc(t, boxID, "twin")
	child := newFootnoteTestDoc(t, boxID, "Child")
	child.Path, child.HPath = "/"+first.ID+"/"+child.ID+".sy", "/Twin/Child"
	first.Root.FirstChild.AppendChild(newFootnoteTestRef(second.Root.FirstChild.ID))
	child.Root.FirstChild.AppendChild(newFootnoteTestRef(second.Root.FirstChild.ID))
	for _, tree := range []*parse.Tree{first, second, child} {
		writeAssetDownloadDocumentTest(t, tree)
	}
	docPaths := []string{child.Path, first.Path, second.Path}
	paths, err := prepareExportDocumentPaths(docPaths, nil, ".md")
	if err != nil {
		t.Fatal(err)
	}
	archive := openExportArchive(t, exportPandocConvertZip0(archiveExportOptions{
		Config: resolveExportOptions(nil), BoxID: boxID, BaseFolderName: "Collisions", DocPaths: docPaths, Ext: ".md",
	}))
	seen := map[string]bool{}
	contents := map[string]string{}
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		key := exportPathComparison(file.Name)
		if seen[key] {
			t.Fatal("archive overwrote a filesystem-equivalent name", file.Name)
		}
		seen[key] = true
		contents[path.Base(file.Name)] = readZipFile(t, file, file.Name)
	}
	if len(contents) != 3 {
		t.Fatalf("distinct document identities were lost: %v", contents)
	}
	for _, source := range []*parse.Tree{first, child} {
		filename := paths.get(boxID, source.ID)
		md := contents[path.Base(filename)]
		href := exportMarkdownRelativePath(path.Dir(filename), paths.get(boxID, second.ID))
		if !strings.Contains(md, href+"#"+second.Root.FirstChild.ID) {
			t.Fatalf("reference used a display path instead of allocated filename %s: %s", href, md)
		}
	}
	if !strings.Contains(contents[path.Base(paths.get(boxID, second.ID))], `id="`+second.Root.FirstChild.ID+`"`) {
		t.Fatal("collision target lost its block anchor")
	}
}
