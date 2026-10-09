//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"archive/zip"
	"bytes"
	"context"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDuplicateDocHPath(t *testing.T) {
	const helper = "SIYUAN_TEST_DUPLICATE_DOC_HPATH"
	if os.Getenv(helper) != "1" {
		// 隔离数据库、密钥和异步任务，使用临时工作空间验证路径寻址。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDuplicateDocHPath$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("duplicate hpath subprocess failed: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	Conf.Flashcard = conf.NewFlashcard()
	const password = "duplicate-hpath-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	for _, encrypted := range []bool{false, true} {
		boxID := ast.NewNodeID()
		if encrypted {
			var err error
			boxID, err = CreateEncryptedBox("Encrypted", password)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = Mount(boxID); err != nil {
				t.Fatal(err)
			}
		} else {
			box := &Box{ID: boxID}
			boxConf := conf.NewBoxConf()
			boxConf.Closed = false
			if err := box.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
		}
		for _, nested := range []bool{false, true} {
			parentPath, parentHPath := "/", ""
			if nested {
				parent := newHPathTestDoc(t, boxID, "/", "Parent", 1)
				parentPath, parentHPath = parent.Path, parent.HPath
			}
			source := newHPathTestDoc(t, boxID, parentPath, "Example  Document", 1)
			// 保存规范化后的源文件，验证重复和导出不会改写原文档或密文。
			source, err := filesys.LoadTree(boxID, source.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			sourceFile := filepath.Join(util.DataDir, boxID, source.Path)
			before, err := os.ReadFile(sourceFile)
			if err != nil || util.IsCiphertext(before) != encrypted {
				t.Fatalf("invalid source fixture: encrypted=%v, %v", encrypted, err)
			}
			DuplicateDoc(source)
			title := source.Root.IALAttr("title")
			wantHPath := parentHPath + "/" + title
			if source.HPath != wantHPath || !strings.HasPrefix(title, "Example  Document (Duplicated ") {
				t.Fatalf("invalid duplicate path: title=%q, hpath=%q", title, source.HPath)
			}
			hpath, err := GetHPathByID(source.ID)
			if err != nil || hpath != wantHPath {
				t.Fatalf("path by ID disagrees: %q, %v", hpath, err)
			}
			ids, err := GetIDsByHPath(wantHPath, boxID)
			if err != nil || len(ids) != 1 || ids[0] != source.ID {
				t.Fatalf("duplicate is not addressable: %v, %v", ids, err)
			}
			sql.FlushQueue()
			block := sql.GetBlockInBox(source.ID, boxID)
			if block == nil || block.Content != title || block.HPath != wantHPath {
				t.Fatalf("SQL title and path disagree: %#v", block)
			}
			childID, err := CreateWithMarkdown("", boxID, wantHPath+"/Child", "Child content", "", "", false, "", nil)
			if err != nil {
				t.Fatal(err)
			}
			child := treenode.GetBlockTreeInBox(childID, boxID)
			if child == nil || path.Dir(child.Path) != strings.TrimSuffix(source.Path, ".sy") {
				t.Fatalf("child created under a different parent: %#v", child)
			}
			exportURI := ExportSYs([]string{source.ID})
			if exportURI == "" {
				t.Fatal("export returned an empty path")
			}
			exportPath, err := url.PathUnescape(exportURI)
			if err != nil {
				t.Fatal(err)
			}
			exportPath = filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(exportPath, "/")))
			if encrypted {
				var ok bool
				_, exportPath, ok = ResolveManagedEncryptedExport(strings.TrimPrefix(exportURI, "/export/"))
				if !ok {
					t.Fatal("encrypted export is not registered")
				}
			}
			archive, err := zip.OpenReader(exportPath)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, file := range archive.File {
				if file.Name == util.FilterFileName(title)+"/"+source.ID+".sy" {
					found = true
				}
			}
			archive.Close()
			if !found {
				t.Fatalf("export folder disagrees with title: %q", title)
			}
			after, err := os.ReadFile(sourceFile)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("source changed: encrypted=%v, nested=%v, %v", encrypted, nested, err)
			}
		}
	}
}
