//go:build fts5

package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportSYAttributeViewCopyFailure(t *testing.T) {
	const boxID = "20261010000000-box0001"
	const docID = "20261010000001-doc0001"
	const avID = "20261010000002-av00001"
	setupExportRelatedTest(t, boxID)
	setupNotebookDocumentImportDatabase(t)
	originalLang, originalAVLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = originalLang, originalAVLangs })
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Notes", "Notes")
	tree.Root.SetIALAttr(av.NodeAttrNameAvs, avID)
	avData, err := json.Marshal(av.NewAttributeView(avID))
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, data := range map[string][]byte{
		"Notes/" + docID + ".sy":             treeToSYJSON(tree),
		"Notes/storage/av/" + avID + ".json": avData,
	} {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, err = entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), "notes.sy.zip")
	if err = os.WriteFile(archivePath, archive.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	avDir := filepath.Join(util.DataDir, "storage", "av")
	if err = os.MkdirAll(filepath.Dir(avDir), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(avDir, []byte("existing data"), 0644); err != nil {
		t.Fatal(err)
	}
	err = ImportSY(archivePath, boxID, "/")
	var pathErr *os.PathError
	if !errors.As(err, &pathErr) || !strings.Contains(pathErr.Path, avDir) {
		t.Fatalf("database copy failure not returned: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, boxID))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sy") {
			t.Fatalf("document written despite database copy failure: %s", entry.Name())
		}
	}
	if data, readErr := os.ReadFile(avDir); readErr != nil || string(data) != "existing data" {
		t.Fatalf("existing data was changed: %q, %v", data, readErr)
	}
	if data, readErr := os.ReadFile(archivePath); readErr != nil || !bytes.Equal(data, archive.Bytes()) {
		t.Fatalf("import archive was changed: %v", readErr)
	}
}
