//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyDocumentCreationEncrypted(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	testLegacyDocumentCreation(t, box)
	for _, bt := range treenode.GetBlockTreesByBoxID(box) {
		if bt.Type != "d" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(util.DataDir, box, bt.Path))
		if err != nil || !util.IsCiphertext(data) {
			t.Fatal("legacy creation wrote plaintext", bt.Path, err)
		}
	}
	before, err := archiveDirectoryFiles(filepath.Join(util.DataDir, box))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = CreateWithMarkdown("private-tag", box, "/Tagged", "private", "", ast.NewNodeID(), false, "", nil); err == nil {
		t.Fatal("encrypted notebook accepted tags")
	}
	after, err := archiveDirectoryFiles(filepath.Join(util.DataDir, box))
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("rejected tagged creation wrote files", err)
	}
	LockBox(box)
	before, err = archiveDirectoryFiles(filepath.Join(util.DataDir, box))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateWithMarkdown("", box, "/Locked/Missing/Leaf", "private", "", ast.NewNodeID(), false, "", nil); err == nil {
		t.Fatal("locked notebook accepted legacy creation")
	}
	after, err = archiveDirectoryFiles(filepath.Join(util.DataDir, box))
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("locked creation wrote files", err)
	}
}
