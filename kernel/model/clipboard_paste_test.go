package model

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPrepareClipboardPasteAssets(t *testing.T) {
	previousWorkspace, previousData, previousConf := util.WorkspaceDir, util.DataDir, Conf
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	Conf.FileTree = conf.NewFileTree()
	Conf.Editor = conf.NewEditor()
	Conf.Editor.VirtualBlockRef = false
	boxID, otherBox := "20260928120000-abcdefg", "20260928120000-hijklmn"
	t.Cleanup(func() {
		LockBox(boxID)
		util.WorkspaceDir, util.DataDir, Conf = previousWorkspace, previousData, previousConf
	})
	write := func(filename string, data []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{boxID, otherBox} {
		boxConf := conf.NewBoxConf()
		boxConf.Encrypted = true
		data, _ := json.Marshal(boxConf)
		write(filepath.Join(util.DataDir, id, ".siyuan", "conf.json"), data)
	}
	dek, err := util.GenerateDEK()
	if err != nil {
		t.Fatal(err)
	}
	setDEKForTest(boxID, dek)
	sourcePath := filepath.Join(util.DataDir, "assets", "sample image.png")
	write(sourcePath, []byte("original image"))
	write(filepath.Join(util.DataDir, "assets", "sample.pdf"), []byte("original PDF"))
	write(filepath.Join(util.DataDir, "assets", "sample.pdf.sya"), []byte(`{"pages":[]}`))
	refs := []string{"assets/sample%20image.png", "assets/sample%20image.png?width=80#fragment",
		"assets/sample.pdf/20260928120000-aaaaaaa?page=2#page", "assets/sample.pdf"}
	result, err := PrepareClipboardPasteAssets(boxID, refs)
	if err != nil {
		t.Fatal(err)
	}
	pathOf := func(reference string) string {
		parsed, err := url.Parse(reference)
		if err != nil {
			t.Fatal(err)
		}
		return parsed.Path
	}
	if pathOf(result[refs[0]]) != pathOf(result[refs[1]]) || !strings.Contains(result[refs[1]], "width=80#fragment") {
		t.Fatalf("duplicate resources or query/fragment were lost: %#v", result)
	}
	if !strings.HasPrefix(result[refs[2]], pathOf(result[refs[3]])+"/20260928120000-aaaaaaa?") ||
		!strings.Contains(result[refs[2]], "page=2#page") {
		t.Fatalf("PDF annotation reference changed: %#v", result)
	}
	for _, entry := range []struct{ reference, original, content string }{
		{result[refs[0]], "sample image.png", "original image"},
		{result[refs[3]], "sample.pdf", "original PDF"},
		{pathOf(result[refs[3]]) + ".sya?box=" + boxID, "sample.pdf.sya", `{"pages":[]}`},
	} {
		filename := pathOf(entry.reference)
		ciphertext, readErr := os.ReadFile(filepath.Join(util.DataDir, boxID, filepath.FromSlash(filename)))
		if readErr != nil || bytes.Contains(ciphertext, []byte(entry.content)) {
			t.Fatalf("attachment was not encrypted: %v", readErr)
		}
		plain, name, decryptErr := DecryptAssetWithName(boxID, filepath.Base(filename), dek, ciphertext)
		if decryptErr != nil || string(plain) != entry.content || name != entry.original {
			t.Fatalf("authenticated content/name changed: %q, %q, %v", plain, name, decryptErr)
		}
	}
	plain, _ := os.ReadFile(sourcePath)
	if string(plain) != "original image" {
		t.Fatal("source attachment was modified")
	}
	assetDir := filepath.Join(util.DataDir, boxID, "assets")
	count := func() int { entries, _ := os.ReadDir(assetDir); return len(entries) }
	before := count()
	for _, reference := range []string{result[refs[0]], pathOf(result[refs[0]])} {
		reused, reuseErr := PrepareClipboardPasteAssets(boxID, []string{reference})
		if reuseErr != nil || pathOf(reused[reference]) != pathOf(reference) || count() != before {
			t.Fatalf("same-notebook resource was not reused: %#v, %v", reused, reuseErr)
		}
	}
	for _, bad := range []string{"assets/missing.png", "assets/../../conf.json", "assets/%2e%2e/conf.json",
		"file:///tmp/file", "assets/sample.pdf?box=" + otherBox, "assets/sample.pdf?box=invalid",
		"assets/sample.pdf?box=" + boxID + "&box=" + otherBox} {
		failed, failure := PrepareClipboardPasteAssets(boxID, []string{refs[0], bad})
		if failure == nil || failed != nil || count() != before {
			t.Fatalf("failed batch left attachments or returned links: %s, %#v, %v", bad, failed, failure)
		}
	}
	LockBox(boxID)
	if failed, failure := PrepareClipboardPasteAssets(boxID, refs); failure == nil || failed != nil || count() != before {
		t.Fatal("locked target accepted paste")
	}
}
