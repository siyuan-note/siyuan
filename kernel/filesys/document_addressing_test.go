// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentAddressingOrdinaryTitleRoundTrip(t *testing.T) {
	box, root, _, _ := setupStalePathTest(t)
	p := "/" + root + ".sy"
	for _, title := range []string{"A&#47;B", "A&amp;#47;B", "A%2FB", "A／B", "**literal** `code`", ".", "..", ""} {
		tree := treenode.NewTree(box, p, "/"+title, title)
		if _, err := WriteTree(tree); err != nil {
			t.Fatal("ordinary title could not be saved", title, err)
		}
		cache.RemoveTreeDataInBox(tree.ID, box)
		loaded, err := LoadTree(box, p, util.NewLute())
		if err != nil || loaded.Root.IALAttr("title") != title {
			t.Fatal("ordinary title changed after load", title, err)
		}
		properties, err := DocIAL(filepath.Join(util.DataDir, box, p))
		if err != nil || properties["title"] != title {
			t.Fatal("ordinary title changed in attribute read", title, err)
		}
	}
}

func TestDocumentAddressingPreservesPlainAndEncryptedSources(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	var future map[string]json.RawMessage
	if err = json.Unmarshal(legacy, &future); err != nil {
		t.Fatal(err)
	}
	future["Spec"] = json.RawMessage(`"999"`)
	legacy, err = json.Marshal(future)
	if err != nil {
		t.Fatal(err)
	}
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			oldData, oldConf := util.DataDir, util.ConfDir
			oldProvider, oldAcquire, oldRelease := DEKProvider, DEKLockAcquire, DEKLockRelease
			util.DataDir, util.ConfDir = t.TempDir(), t.TempDir()
			DEKLockAcquire, DEKLockRelease = nil, nil
			t.Cleanup(func() {
				util.DataDir, util.ConfDir = oldData, oldConf
				DEKProvider, DEKLockAcquire, DEKLockRelease = oldProvider, oldAcquire, oldRelease
			})
			const boxID = "20261022000000-abcdefg"
			const document = "/20261022000001-hijklmn/20261022000002-opqrstu.sy"
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
			}
			decryptCalls := 0
			DEKProvider = func(string) ([]byte, error) { decryptCalls++; return bytes.Clone(dek), nil }
			source, err := encryptDataWithDEK(boxID, document, legacy, dek)
			if err != nil {
				t.Fatal(err)
			}
			absPath := writeStalePathFixture(t, boxID, document, source)
			writeStalePathFixture(t, boxID, documentaddressing.ConfigPath, []byte(`{"documentAddressingVersion":3}`))
			readers := map[string]func() error{
				"properties":        func() error { _, err := DocIAL(absPath); return err },
				"parent properties": func() error { _, err := readParentDocIAL(absPath); return err },
				"path":              func() error { _, _, err := ReadDocHPath(boxID, document); return err },
				"tree":              func() error { _, err := LoadTree(boxID, document, util.NewLute()); return err },
				"decoded tree":      func() error { _, err := LoadTreeByData(legacy, boxID, document, util.NewLute()); return err },
				"write": func() error {
					_, err := WriteTree(treenode.NewTree(boxID, document, "/Parent/Child", "Child"))
					return err
				},
			}
			for name, read := range readers {
				if err := read(); !(name == "path" && os.IsNotExist(err)) && !errors.Is(err, treenode.ErrSpecTooNew) {
					t.Fatalf("%s: %v", name, err)
				}
			}
			if encrypted && decryptCalls == 0 {
				t.Fatal("encrypted source was not authenticated")
			}
			actual, err := os.ReadFile(absPath)
			if err != nil || !bytes.Equal(actual, source) {
				t.Fatal("source changed")
			}
			parent := filepath.Join(util.DataDir, boxID, "20261022000001-hijklmn.sy")
			if _, err = os.Stat(parent); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("parent was repaired")
			}
		})
	}
}
