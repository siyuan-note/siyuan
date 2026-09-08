package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTableCellRichEncryptedLegacyReadAndAuthentication(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if nil != err {
		t.Fatal(err)
	}
	originalDataDir, originalProvider := util.DataDir, DEKProvider
	originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
	util.DataDir = t.TempDir()
	dek := bytes.Repeat([]byte{19}, 32)
	DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
	DEKLockAcquire, DEKLockRelease = nil, nil
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir, DEKProvider = originalDataDir, originalProvider
		DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
	})
	boxID, documentPath := "20260908000000-box0001", "/20260908000000-root001.sy"
	ciphertext, err := encryptDataWithDEK(boxID, documentPath, legacy, dek)
	if nil != err {
		t.Fatal(err)
	}
	absPath := filepath.Join(util.DataDir, boxID, documentPath)
	if err = os.MkdirAll(filepath.Dir(absPath), 0700); nil != err {
		t.Fatal(err)
	}
	if err = os.WriteFile(absPath, ciphertext, 0600); nil != err {
		t.Fatal(err)
	}
	tree, err := LoadTree(boxID, documentPath, util.NewLute())
	if nil != err {
		t.Fatal(err)
	}
	if tree.Root.Spec != "2" || tree.Root.FirstChild.LastChild.FirstChild.TableCellRich != nil {
		t.Fatal("reading a supported encrypted document must not enable rich text")
	}
	cell := tree.Root.FirstChild.LastChild.FirstChild
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "- first\n- second"}
	treenode.UpgradeSpec(tree)
	luteEngine := util.NewLute()
	for _, invalid := range []ast.TableCellRich{
		{Spec: 99, Format: "kramdown", Content: "preserve"},
		{Spec: 1, Format: "kramdown", Content: "preserve\x00source"},
	} {
		cell.TableCellRich = &invalid
		data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
		invalidCiphertext, encryptErr := encryptDataWithDEK(boxID, documentPath, data, dek)
		if encryptErr != nil {
			t.Fatal(encryptErr)
		}
		if err = os.WriteFile(absPath, invalidCiphertext, 0600); err != nil {
			t.Fatal(err)
		}
		cache.ClearTreeCache()
		if _, err = LoadTree(boxID, documentPath, luteEngine); err == nil {
			t.Fatal("unknown or corrupt rich source must fail before document repair")
		}
		retained, readErr := os.ReadFile(absPath)
		if readErr != nil || !bytes.Equal(invalidCiphertext, retained) {
			t.Fatal("rejected source must retain its authenticated ciphertext")
		}
	}
	cache.ClearTreeCache()
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(absPath, ciphertext, 0600); nil != err {
		t.Fatal(err)
	}
	if _, err = LoadTree(boxID, documentPath, util.NewLute()); nil == err {
		t.Fatal("authentication failure must not fall back to plaintext or repaired data")
	}
	retained, err := os.ReadFile(absPath)
	if nil != err || !bytes.Equal(ciphertext, retained) {
		t.Fatal("failed reads must preserve source ciphertext")
	}
}
