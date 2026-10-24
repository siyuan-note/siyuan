package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestDocumentAddressingTitleConflictPreservesSources(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err = json.Unmarshal(legacy, &doc); err != nil {
		t.Fatal(err)
	}
	doc["Properties"] = json.RawMessage(`{"title":"private/title"}`)
	conflict, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	conflict = append([]byte("\xef\xbb\xbf"), conflict...)
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, parent, p, _ := setupStalePathTest(t)
			oldConf := util.ConfDir
			oldProvider, oldAcquire, oldRelease := DEKProvider, DEKLockAcquire, DEKLockRelease
			util.ConfDir = t.TempDir()
			DEKLockAcquire, DEKLockRelease = nil, nil
			t.Cleanup(func() {
				util.ConfDir = oldConf
				DEKProvider, DEKLockAcquire, DEKLockRelease = oldProvider, oldAcquire, oldRelease
			})
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			source, err := encryptDataWithDEK(box, p, conflict, dek)
			if err != nil {
				t.Fatal(err)
			}
			absPath := writeStalePathFixture(t, box, p, source)
			before, err := os.Stat(absPath)
			if err != nil {
				t.Fatal(err)
			}
			operations := map[string]func() error{
				"properties": func() error { _, err := DocIAL(absPath); return err },
				"parent":     func() error { _, err := readParentDocIAL(absPath); return err },
				"load":       func() error { _, err := LoadTree(box, p, util.NewLute()); return err },
				"snapshot": func() error {
					_, _, err := LoadTreeSnapshot(box, p, util.NewLute())
					return err
				},
				"cached source": func() error {
					cache.SetTreeDataInBox(util.GetTreeID(p), box, conflict)
					defer cache.RemoveTreeDataInBox(util.GetTreeID(p), box)
					deadline := time.Now().Add(time.Second)
					for {
						if _, ok := cache.GetTreeDataInBox(util.GetTreeID(p), box); ok {
							break
						}
						if time.Now().After(deadline) {
							t.Fatal("cache entry was not published")
						}
						time.Sleep(time.Millisecond)
					}
					_, err := LoadTree(box, p, util.NewLute())
					return err
				},
				"conditional overwrite": func() error {
					_, err := WriteTreeIfUnchanged(treenode.NewTree(box, p, "/Legacy", "Legacy"), source)
					return err
				},
				"ordinary overwrite": func() error {
					_, err := WriteTree(treenode.NewTree(box, p, "/Legacy", "Legacy"))
					return err
				},
				"new source write": func() error {
					_, err := WriteTree(treenode.NewTree(box, p, "/private/title", "private/title"))
					return err
				},
			}
			for name, operation := range operations {
				if err := operation(); !errors.Is(err, documentaddressing.ErrModeConflict) || errors.Is(err, ErrInvalidDocIAL) {
					t.Errorf("%s did not preserve title conflict: %v", name, err)
				}
			}
			actual, err := os.ReadFile(absPath)
			if err != nil || !bytes.Equal(source, actual) {
				t.Fatal("conflicting source was changed")
			}
			after, err := os.Stat(absPath)
			if err != nil || !before.ModTime().Equal(after.ModTime()) {
				t.Fatal("conflicting source modification time changed")
			}
			if _, err = os.Stat(filepath.Join(util.DataDir, box, parent+".sy")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("missing parent was repaired before source validation")
			}
			if _, _, err = ReadDocHPath(box, p); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("path read did not retain the missing-parent error", err)
			}
			if _, err = WriteTree(treenode.NewTree(box, "/"+parent+".sy", "/Parent", "Parent")); err != nil {
				t.Fatal(err)
			}
			if _, _, err = ReadDocHPath(box, p); !errors.Is(err, documentaddressing.ErrModeConflict) {
				t.Fatal("path read accepted a conflicting descendant", err)
			}
			if entries, err := os.ReadDir(util.ConfDir); err != nil || len(entries) != 0 {
				t.Fatal("source conflict silently activated the notebook")
			}
			if encrypted {
				corrupt := bytes.Clone(source)
				corrupt[len(corrupt)-1] ^= 1
				if err = os.WriteFile(absPath, corrupt, 0600); err != nil {
					t.Fatal(err)
				}
				if _, err = DocIAL(absPath); err == nil || errors.Is(err, documentaddressing.ErrModeConflict) {
					t.Fatal("title inspection bypassed source authentication", err)
				}
			}
		})
	}
}

func TestDocumentAddressingPreservesPlainAndEncryptedSources(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
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
				if err := read(); !errors.Is(err, documentaddressing.ErrUnsupported) {
					t.Fatalf("%s: %v", name, err)
				}
			}
			if decryptCalls != 0 {
				t.Fatal("unsupported notebook reached decryption")
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
