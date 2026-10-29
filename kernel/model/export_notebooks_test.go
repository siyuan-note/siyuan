// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"archive/zip"
	"bytes"
	"io"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportNotebookMarkdownPathsKeepsDuplicateNamesSeparate(t *testing.T) {
	boxes := []*Box{
		{ID: "20260814000000-box0001", Name: "Notes"},
		{ID: "20260814000000-box0002", Name: "Notes"},
		{ID: "20260814000000-box0003", Name: "notes"},
	}
	paths := exportNotebookMarkdownPaths(boxes, nil)
	if paths[boxes[0].ID] != "Notes" {
		t.Fatalf("unexpected first notebook path: %q", paths[boxes[0].ID])
	}
	expectedSecond := "Notes-" + boxes[1].ID
	if paths[boxes[1].ID] != expectedSecond {
		t.Fatalf("unexpected second notebook path: %q", paths[boxes[1].ID])
	}
	expectedThird := "notes-" + boxes[2].ID
	if paths[boxes[2].ID] != expectedThird {
		t.Fatalf("unexpected third notebook path: %q", paths[boxes[2].ID])
	}
}

func TestExportNotebookNamesPreserveSlashesAndAvoidFilesystemCollisions(t *testing.T) {
	const boxID = "20261025000000-box0001"
	setupExportRelatedTest(t, boxID)
	box := Conf.Box(boxID)
	boxConf := box.GetConf()
	boxConf.Name = "Research/2026／Notes"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	archivePath := ExportNotebookSY(boxID)
	if archivePath != "/export/"+url.PathEscape("Research_2026／Notes.sy.zip") {
		t.Fatalf("notebook name became a path: %q", archivePath)
	}
	absPath, err := exportedFilePath(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	notebook, err := inspectSYNotebookArchive(absPath)
	if err != nil || notebook.name != boxConf.Name {
		t.Fatalf("archive lost the original notebook name: %+v, %v", notebook, err)
	}
	decodedArchivePath, err := url.PathUnescape(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	archive := openExportArchive(t, decodedArchivePath)
	for _, file := range archive.File {
		if !strings.HasPrefix(file.Name, "Research_2026／Notes/") {
			t.Fatalf("unexpected export root: %s", file.Name)
		}
	}

	boxes := []*Box{
		{ID: "20261025000000-box0001", Name: "A/B"},
		{ID: "20261025000000-box0002", Name: "A_B"},
		{ID: "20261025000000-box0003", Name: "A／B"},
		{ID: "20261025000000-box0004", Name: "É"},
		{ID: "20261025000000-box0005", Name: "e\u0301"},
		{ID: "20261025000000-box0006", Name: "CON"},
		{ID: "20261025000000-box0007", Name: "_CON"},
		{ID: "20261025000000-box0008", Name: strings.Repeat("long", 40)},
		{ID: "20261025000000-box0009", Name: strings.Repeat("long", 40)},
	}
	boxPaths := exportNotebookMarkdownPaths(boxes, nil)
	var locations []exportDocumentLocation
	for _, box := range boxes {
		locations = append(locations, exportDocumentLocation{identity: exportDocumentIdentity{box: box.ID, id: box.ID},
			parent: exportDocumentIdentity{box: box.ID}, title: "Document"})
	}
	paths, err := allocateExportDocumentPaths(locations, boxPaths, ".md")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, box := range boxes {
		name := boxPaths[box.ID]
		if strings.ContainsAny(name, `/\`) || seen[exportPathComparison(name)] {
			t.Fatalf("unsafe or colliding notebook directory: %q", name)
		}
		seen[exportPathComparison(name)] = true
		if got := paths.get(box.ID, box.ID); got != "/"+name+"/Document.md" {
			t.Fatalf("allocated notebook name changed before link generation: %q", got)
		}
	}
}

func TestExportMarkdownHPathIncludesNotebook(t *testing.T) {
	boxPaths := map[string]string{
		"20260814000000-box0001": "Notebook A",
		"20260814000000-box0002": "Notebook B",
	}
	source := exportMarkdownHPath("20260814000000-box0001", "/Source", boxPaths)
	target := exportMarkdownHPath("20260814000000-box0002", "/Folder/Target.md", boxPaths)
	if source != "/Notebook A/Source" {
		t.Fatalf("unexpected source path: %q", source)
	}
	if target != "/Notebook B/Folder/Target.md" {
		t.Fatalf("unexpected target path: %q", target)
	}
	reference := exportMarkdownRelativePath(filepath.ToSlash(filepath.Dir(source)), target+"#20260814000000-block01")
	if reference != "../Notebook B/Folder/Target.md#20260814000000-block01" {
		t.Fatalf("unexpected cross-notebook reference: %q", reference)
	}
}

func TestExportNotebooksSYKeepsCrossNotebookReferences(t *testing.T) {
	const (
		sourceBoxID   = "20260814000100-box0001"
		targetBoxID   = "20260814000101-box0002"
		sourceDocID   = "20260814000102-doc0001"
		targetDocID   = "20260814000103-doc0002"
		sourceBlockID = "20260814000104-block01"
		targetBlockID = "20260814000105-block02"
	)
	setupExportRelatedTest(t, sourceBoxID, targetBoxID)
	for _, boxID := range []string{sourceBoxID, targetBoxID} {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Name = "Notebook"
		if err := box.SaveConf(boxConf); nil != err {
			t.Fatal(err)
		}
	}

	for _, boxID := range []string{sourceBoxID, targetBoxID} {
		boxTree := treenode.NewTree(boxID, boxDocPath(boxID), "/"+boxID, boxID)
		boxTree.Root.SetIALAttr(DocHiddenAttr, "true")
		writeExportRelatedTestTree(t, boxTree)
	}
	sourceTree := treenode.NewTree(sourceBoxID, "/"+sourceDocID+".sy", "/Source", "Source")
	sourceBlock := treenode.NewParagraph(sourceBlockID)
	sourceBlock.AppendChild(&ast.Node{
		Type:                    ast.NodeTextMark,
		TextMarkType:            "block-ref",
		TextMarkBlockRefID:      targetBlockID,
		TextMarkBlockRefSubtype: "d",
		TextMarkTextContent:     "Target",
	})
	sourceTree.Root.AppendChild(sourceBlock)
	targetTree := treenode.NewTree(targetBoxID, "/"+targetDocID+".sy", "/Target", "Target")
	targetTree.Root.AppendChild(treenode.NewParagraph(targetBlockID))
	writeExportRelatedTestTree(t, sourceTree)
	writeExportRelatedTestTree(t, targetTree)

	exportPath := ExportNotebooksSY([]string{sourceBoxID, targetBoxID})
	exportAbsPath, err := exportedFilePath(exportPath)
	if nil != err {
		t.Fatal(err)
	}
	if !isSYNotebookBundle(exportAbsPath) {
		t.Fatal("exported archive was not detected as a notebook bundle")
	}
	if err = ImportSY(exportAbsPath, sourceBoxID, "/"); nil == err {
		t.Fatal("notebook bundle should not be imported into a document")
	}
	syArchive := openExportArchive(t, exportPath)
	syRoot := "Notebook-2"
	sourceArchivePath := filepath.ToSlash(filepath.Join(syRoot, "notebooks", "Notebook.sy.zip"))
	targetArchivePath := filepath.ToSlash(filepath.Join(syRoot, "notebooks", "Notebook-"+targetBoxID+".sy.zip"))
	for _, expected := range []string{
		filepath.ToSlash(filepath.Join(syRoot, syNotebookBundleManifestPath)),
		sourceArchivePath,
		targetArchivePath,
	} {
		if findArchiveFile(syArchive.File, expected) == nil {
			t.Fatalf("missing SiYuan archive entry: %s", expected)
		}
	}
	manifest := &syNotebookBundleManifest{}
	manifestPath := filepath.ToSlash(filepath.Join(syRoot, syNotebookBundleManifestPath))
	if err := gulu.JSON.UnmarshalJSON([]byte(readArchiveFile(t, syArchive, manifestPath)), manifest); nil != err {
		t.Fatal(err)
	}
	if manifest.Spec != syNotebookBundleSpec || len(manifest.Notebooks) != 2 {
		t.Fatalf("unexpected notebook bundle manifest: %+v", manifest)
	}
	sourceArchive := openNestedArchive(t, syArchive, sourceArchivePath)
	sourceSYPath := filepath.ToSlash(filepath.Join("Notebook", sourceDocID+".sy"))
	if sourceSY := readNestedArchiveFile(t, sourceArchive, sourceSYPath); !strings.Contains(sourceSY, targetBlockID) {
		t.Fatalf("cross-notebook reference %q not found in exported source document", targetBlockID)
	}
	if findArchiveFile(sourceArchive.File, filepath.ToSlash(filepath.Join("Notebook", targetDocID+".sy"))) != nil {
		t.Fatal("target notebook document was duplicated into the source notebook archive")
	}
	targetArchive := openNestedArchive(t, syArchive, targetArchivePath)
	if findArchiveFile(targetArchive.File, filepath.ToSlash(filepath.Join("Notebook", targetDocID+".sy"))) == nil {
		t.Fatal("target document is missing from its notebook archive")
	}
}

func TestImportNotebooksSYKeepsEmptyNotebooks(t *testing.T) {
	const (
		firstBoxID  = "20260817000100-box0001"
		secondBoxID = "20260817000101-box0002"
	)
	setupExportRelatedTest(t, firstBoxID, secondBoxID)
	for _, boxID := range []string{firstBoxID, secondBoxID} {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Name = boxID
		if err := box.SaveConf(boxConf); nil != err {
			t.Fatal(err)
		}
	}

	exportPath := ExportNotebooksSY([]string{firstBoxID, secondBoxID})
	exportAbsPath, err := exportedFilePath(exportPath)
	if nil != err {
		t.Fatal(err)
	}
	boxIDs, bundle, err := ImportSYNotebookBundle(exportAbsPath)
	if nil != err {
		t.Fatal(err)
	}
	if !bundle {
		t.Fatal("exported archive was not detected as a notebook bundle")
	}
	if len(boxIDs) != 2 {
		t.Fatalf("imported %d notebooks, want 2", len(boxIDs))
	}

	singleExportPath := ExportNotebookSY(firstBoxID)
	singleExportAbsPath, err := exportedFilePath(singleExportPath)
	if nil != err {
		t.Fatal(err)
	}
	if err = ImportSY(singleExportAbsPath, secondBoxID, "/"); nil == err {
		t.Fatal("empty notebook archive should not be imported as documents")
	}
}

func openExportArchive(t *testing.T, exportPath string) *zip.ReadCloser {
	t.Helper()
	if exportPath == "" {
		t.Fatal("export returned an empty archive path")
	}
	absPath := filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(exportPath, "/")))
	archive, err := zip.OpenReader(absPath)
	if err != nil {
		t.Fatalf("open exported archive failed: %s", err)
	}
	t.Cleanup(func() {
		_ = archive.Close()
	})
	return archive
}

func readArchiveFile(t *testing.T, archive *zip.ReadCloser, name string) string {
	t.Helper()
	return readZipFile(t, findArchiveFile(archive.File, name), name)
}

func openNestedArchive(t *testing.T, archive *zip.ReadCloser, name string) *zip.Reader {
	t.Helper()
	file := findArchiveFile(archive.File, name)
	if nil == file {
		t.Fatalf("archive entry not found: %s", name)
	}
	reader, err := file.Open()
	if nil != err {
		t.Fatal(err)
	}
	data, err := io.ReadAll(reader)
	_ = reader.Close()
	if nil != err {
		t.Fatal(err)
	}
	nested, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if nil != err {
		t.Fatal(err)
	}
	return nested
}

func readNestedArchiveFile(t *testing.T, archive *zip.Reader, name string) string {
	t.Helper()
	return readZipFile(t, findArchiveFile(archive.File, name), name)
}

func findArchiveFile(files []*zip.File, name string) *zip.File {
	for _, file := range files {
		if file.Name == name {
			return file
		}
	}
	return nil
}

func readZipFile(t *testing.T, file *zip.File, name string) string {
	t.Helper()
	if nil != file {
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		defer reader.Close()
		data, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	t.Fatalf("archive entry not found: %s", name)
	return ""
}
