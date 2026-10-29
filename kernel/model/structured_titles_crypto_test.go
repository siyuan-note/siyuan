// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const structuredTitlesCryptoPassword = "structured-title-regression-password"

func prepareStructuredTitlesCryptoTest(t *testing.T) bool {
	t.Helper()
	const helper = "SIYUAN_TEST_STRUCTURED_TITLES_CRYPTO"
	if os.Getenv(helper) != t.Name() {
		// 密钥、数据库及后台任务在独立进程和临时工作空间中验证。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
		command.Env = append(os.Environ(), helper+"="+t.Name())
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted structured titles: %v\n%s", err, output)
		}
		return false
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	Conf.Flashcard.Store(conf.NewFlashcard())
	if err := EnableEncryptedNotebook(structuredTitlesCryptoPassword); err != nil {
		t.Fatal(err)
	}
	return true
}

func newStructuredTitlesEncryptedBox(t *testing.T) string {
	t.Helper()
	id, err := CreateEncryptedBox("Private titles", structuredTitlesCryptoPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(id); err != nil {
		t.Fatal(err)
	}
	indexStructuredTitlesEncryptedBox(t, id)
	t.Cleanup(func() { LockBox(id) })
	return id
}

func indexStructuredTitlesEncryptedBox(t *testing.T, id string) {
	t.Helper()
	// 隔离进程不启动任务调度器，同步执行挂载和导入排队的真实索引操作。
	indexBox(id)
	sql.FlushQueue()
	if treenode.DocumentMetadataState(id) != "ready" {
		t.Fatal("encrypted document metadata did not become ready")
	}
}

func createStructuredTitlesEncryptedDoc(t *testing.T, box string, parent *string, title string) *treenode.DocumentPath {
	t.Helper()
	id := ast.NewNodeID()
	document, err := CreateDocByParent(DocumentCreateRequest{Notebook: box, ParentID: parent, ID: id,
		TitleFormat: "plain", Title: title, Markdown: "Encrypted content " + id})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := filesys.LoadTree(box, document.Path, util.NewLute())
	if err != nil || treenode.ReadDocumentTitle(loaded.Root).Text != title {
		t.Fatal("encrypted source changed its title", err)
	}
	if strings.Contains(title, "/") && loaded.Root.Spec != treenode.DocumentTitleSpec {
		t.Fatal("slash title did not retain its source specification")
	}
	return document
}

func structuredTitlesCiphertext(t *testing.T, document *treenode.DocumentPath) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(util.DataDir, document.Notebook, document.Path))
	if err != nil || !util.IsCiphertext(data) {
		t.Fatal("document is not stored as ciphertext", err)
	}
	return data
}

func TestStructuredTitlesEncryptedLockAndHistory(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	literal := createStructuredTitlesEncryptedDoc(t, box, nil, "A/B")
	parent := createStructuredTitlesEncryptedDoc(t, box, nil, "A")
	child := createStructuredTitlesEncryptedDoc(t, box, &parent.ID, "B")
	if literal.DisplayPath != child.DisplayPath || literal.Depth != 1 || child.Depth != 2 {
		t.Fatal("encrypted display path collision changed document identity")
	}
	if ids, err := GetIDsByHPath("/A", box); err != nil || len(ids) != 1 || ids[0] != parent.ID {
		t.Fatal("clean encrypted legacy path failed", ids, err)
	}
	if ids, err := GetIDsByHPath("/A/B", box); !errors.Is(err, documentaddressing.ErrPathAmbiguous) || len(ids) != 0 {
		t.Fatal("encrypted collision accepted", ids, err)
	}
	literalSource := structuredTitlesCiphertext(t, literal)
	childSource := structuredTitlesCiphertext(t, child)
	keys, err := json.Marshal(currentNotebookCrypto())
	if err != nil {
		t.Fatal(err)
	}
	if err = RenameDoc(box, parent.Path, "Parent/renamed"); err != nil {
		t.Fatal(err)
	}
	drainHPathRefreshTest(t)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, child.Path), childSource)
	crypt, err := GetBoxEncryption(box)
	if err != nil {
		t.Fatal(err)
	}
	LockBox(box)
	if ids, err := GetIDsByHPath("/A/B", box); err == nil || len(ids) != 0 {
		t.Fatal("locked notebook exposed legacy candidates", ids, err)
	}
	if _, _, err = GetDocPaths(box, []string{literal.ID, child.ID}); err == nil {
		t.Fatal("locked notebook exposed structured titles")
	}
	if _, err = UnlockAndMountBox(box, "incorrect-password", crypt); err == nil || IsBoxUnlocked(box) {
		t.Fatal("incorrect password opened the encrypted notebook")
	}
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, literal.Path), literalSource)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, child.Path), childSource)
	if _, err = UnlockAndMountBox(box, structuredTitlesCryptoPassword, crypt); err != nil {
		t.Fatal(err)
	}
	indexStructuredTitlesEncryptedBox(t, box)
	for _, item := range []struct {
		segments []string
		id       string
	}{{[]string{"A/B"}, literal.ID}, {[]string{"Parent/renamed", "B"}, child.ID}} {
		resolved, resolveErr := ResolveDocPath(box, "root", nil, item.segments)
		if resolveErr != nil || resolved.Resolved == nil || resolved.Resolved.ID != item.id {
			t.Fatalf("unlock changed structured identity: %+v, %v", resolved, resolveErr)
		}
		if sql.GetBlock(item.id) != nil {
			t.Fatal("private title escaped into the global index")
		}
	}
	currentKeys, err := json.Marshal(currentNotebookCrypto())
	if err != nil || !bytes.Equal(keys, currentKeys) {
		t.Fatal("locking or unlocking changed recovery keys", err)
	}
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, literal.Path), literalSource)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, child.Path), childSource)

	historyRelative := filepath.Join("history", "2026-10-23-120000-update", box, literal.ID+".sy")
	history := filepath.Join(util.WorkspaceDir, historyRelative)
	if err = os.MkdirAll(filepath.Dir(history), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(history, literalSource, 0600); err != nil {
		t.Fatal(err)
	}
	if err = RenameDoc(box, literal.Path, "Changed/title"); err != nil {
		t.Fatal(err)
	}
	if _, _, content, _, historyErr := GetDocHistoryContent(historyRelative, "", false); historyErr != nil ||
		!strings.Contains(content, "Encrypted content "+literal.ID) {
		t.Fatal("encrypted history preview lost its content", historyErr)
	}
	if err = RollbackDocHistory(historyRelative); err != nil {
		t.Fatal(err)
	}
	restored, err := filesys.LoadTree(box, literal.Path, util.NewLute())
	if err != nil || restored.ID != literal.ID || restored.Root.Spec != treenode.DocumentTitleSpec ||
		treenode.ReadDocumentTitle(restored.Root).Text != "A/B" {
		t.Fatal("history recovery changed title, identity or source specification", err)
	}
	structuredTitlesCiphertext(t, literal)
	assertEncryptedFileBytes(t, history, literalSource)
}

func readStructuredTitlesEncryptedArchive(t *testing.T, uri string) (string, map[string]string) {
	t.Helper()
	_, filename, ok := ResolveManagedEncryptedExport(strings.TrimPrefix(uri, "/export/"))
	if !ok {
		t.Fatal("encrypted export is not managed")
	}
	archive, err := zip.OpenReader(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	entries := map[string]string{}
	seen := map[string]bool{}
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		key := exportPathComparison(file.Name)
		if seen[key] {
			t.Fatal("export overwrote a filesystem-equivalent path", file.Name)
		}
		seen[key] = true
		entries[file.Name] = readZipFile(t, file, file.Name)
	}
	return filename, entries
}

func TestStructuredTitlesEncryptedArchiveRoundTrip(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	sourceBox, targetBox := newStructuredTitlesEncryptedBox(t), newStructuredTitlesEncryptedBox(t)
	root := createStructuredTitlesEncryptedDoc(t, sourceBox, nil, "Private root")
	parent := createStructuredTitlesEncryptedDoc(t, sourceBox, &root.ID, "A")
	child := createStructuredTitlesEncryptedDoc(t, sourceBox, &parent.ID, "B")
	literal := createStructuredTitlesEncryptedDoc(t, sourceBox, &root.ID, "A/B")
	documents := []*treenode.DocumentPath{root, parent, child, literal}
	original := map[string][]byte{}
	for _, document := range documents {
		original[document.ID] = structuredTitlesCiphertext(t, document)
	}
	Conf.Export.Load().IncludeSubDocs, Conf.Export.Load().AddTitle = true, true
	_, markdownURI := ExportPandocConvertZipWithOptions([]string{root.ID}, "", ".md", nil)
	_, markdown := readStructuredTitlesEncryptedArchive(t, markdownURI)
	for _, document := range documents {
		matches := 0
		for name, content := range markdown {
			if strings.HasSuffix(name, ".md") && strings.Contains(content, "Encrypted content "+document.ID) {
				matches++
				if !strings.Contains(content, "# "+document.Title.Text) {
					t.Fatal("Markdown export changed a literal title", document.ID)
				}
			}
		}
		if matches != 1 {
			t.Fatal("Markdown export lost or duplicated a document", document.ID, matches)
		}
	}
	nativeURI := ExportSYs([]string{root.ID})
	nativePath, _ := readStructuredTitlesEncryptedArchive(t, nativeURI)
	if err := ImportSY(nativePath, targetBox, "/"); err != nil {
		t.Fatal(err)
	}
	indexStructuredTitlesEncryptedBox(t, targetBox)
	for _, document := range documents {
		segments := make([]string, 0, len(document.Segments))
		for _, segment := range document.Segments {
			segments = append(segments, segment.Text)
		}
		resolved, err := ResolveDocPath(targetBox, "root", nil, segments)
		if err != nil || resolved.Resolved == nil || resolved.Resolved.ID == document.ID ||
			resolved.Resolved.Title.Text != document.Title.Text || resolved.Resolved.Depth != document.Depth {
			t.Fatalf("native import changed identity or title boundaries: %+v, %v", resolved, err)
		}
		imported := resolved.Resolved
		structuredTitlesCiphertext(t, imported)
		loaded, err := filesys.LoadTree(targetBox, imported.Path, util.NewLute())
		if err != nil || loaded.ID != imported.ID || treenode.ReadDocumentTitle(loaded.Root).Text != document.Title.Text ||
			(strings.Contains(document.Title.Text, "/") && loaded.Root.Spec != treenode.DocumentTitleSpec) {
			t.Fatal("imported encrypted source lost its title or specification", err)
		}
		if !strings.Contains(loaded.Root.Text(), "Encrypted content "+document.ID) {
			t.Fatal("native import lost the document content", document.ID)
		}
		assertEncryptedFileBytes(t, filepath.Join(util.DataDir, sourceBox, document.Path), original[document.ID])
	}
	LockBox(sourceBox)
	for _, uri := range []string{markdownURI, nativeURI} {
		if _, _, ok := ResolveManagedEncryptedExport(strings.TrimPrefix(uri, "/export/")); ok {
			t.Fatal("locking the source notebook retained a plaintext export")
		}
	}
	resolved, err := ResolveDocPath(targetBox, "root", nil, []string{"Private root", "A/B"})
	if err != nil || resolved.Resolved == nil || resolved.Resolved.Title.Text != "A/B" {
		t.Fatal("locking the source invalidated the imported encrypted document", err)
	}
}
