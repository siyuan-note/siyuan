// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewBOMReadAndSave(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "encrypted"}[encrypted], func(t *testing.T) {
			setupCollectionIndexTest(t)
			boxID := ""
			if encrypted {
				boxID = "20261028120000-bombox0"
			}
			oldProvider, oldBoxes := AVDEKProvider, AVEncryptedBoxIDs
			oldAcquire, oldRelease := AVLockAcquire, AVLockRelease
			AVDEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{0x42}, 32), nil }
			AVEncryptedBoxIDs = func() []string { return []string{boxID} }
			AVLockAcquire, AVLockRelease = nil, nil
			t.Cleanup(func() {
				AVDEKProvider, AVEncryptedBoxIDs = oldProvider, oldBoxes
				AVLockAcquire, AVLockRelease = oldAcquire, oldRelease
			})
			view := collectionIndexTestView()
			view.Spec, view.Name = PlainTextSpec, "BOM database"
			SetAVBoxID(view.ID, boxID)
			t.Cleanup(func() { SetAVBoxID(view.ID, "") })
			raw, err := json.Marshal(view)
			if err != nil {
				t.Fatal(err)
			}
			plain := append([]byte{0xef, 0xbb, 0xbf}, raw...)
			disk := plain
			if encrypted {
				disk, err = encryptAVData(boxID, view.ID, plain)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := attributeViewDataPathByBox(view.ID, boxID)
			if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, disk, 0600); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				info, readErr := GetAttributeViewSearchInfoInBox(view.ID, boxID)
				if readErr != nil || info == nil || info.Name != view.Name {
					t.Fatalf("search: %+v, %v", info, readErr)
				}
				index, readErr := BlockCollectionIndexInBox(boxID)
				if readErr != nil || index.Empty() {
					t.Fatalf("collection: %+v, %v", index, readErr)
				}
				loaded, readErr := ParseAttributeViewForIndexInBox(view.ID, boxID)
				if readErr != nil || loaded.Name != view.Name {
					t.Fatalf("full parse: %+v, %v", loaded, readErr)
				}
				view = loaded
			}
			actual, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(actual, disk) {
				t.Fatal("read changed source", err)
			}
			release := RecordSourceWrites(view, func() bool { return true }, func(_ string, before, after []byte) error {
				if !bytes.Equal(before, disk) {
					t.Fatal("recorder lost original bytes")
				}
				return nil
			})
			view.Name = "Saved database"
			err = SaveAttributeView(view)
			release()
			if err != nil {
				t.Fatal(err)
			}
			actual, err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if encrypted {
				actual, err = decryptAVData(boxID, view.ID, actual)
				if err != nil {
					t.Fatal(err)
				}
			}
			if bytes.HasPrefix(actual, []byte{0xef, 0xbb, 0xbf}) || !json.Valid(actual) {
				t.Fatal("save did not produce BOM-free JSON")
			}
			cache.ClearAVCache()
			loaded, err := ParseAttributeViewForIndexInBox(view.ID, boxID)
			if err != nil || loaded.Name != view.Name {
				t.Fatalf("saved data: %+v, %v", loaded, err)
			}
			if encrypted {
				previous, readErr := decryptAVData(boxID, view.ID, disk)
				if readErr != nil {
					t.Fatal(readErr)
				}
				recovered, readErr := ParseAttributeViewData(view.ID, previous)
				if readErr != nil || recovered.Name != "BOM database" {
					t.Fatal("original ciphertext is not recoverable", readErr)
				}
				// 密文前的 BOM 不属于已认证明文，必须拒绝且保留源文件。
				invalid := append([]byte{0xef, 0xbb, 0xbf}, disk...)
				if err = os.WriteFile(path, invalid, 0600); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				if _, err = ParseAttributeViewForIndexInBox(view.ID, boxID); err == nil {
					t.Fatal("accepted unauthenticated prefix")
				}
				actual, err = os.ReadFile(path)
				if err != nil || !bytes.Equal(actual, invalid) {
					t.Fatal("failed authentication changed source", err)
				}
			}
		})
	}
}

func TestAttributeViewBOMParsingBoundaries(t *testing.T) {
	const id = "20261028120000-bomav00"
	for _, data := range [][]byte{
		[]byte(`{"spec": 6, "name": "before\ufeffafter"}`),
		[]byte("\xef\xbb\xbf{\"spec\": 6, \"name\": \"before\\ufeffafter\"}"),
	} {
		view, err := ParseAttributeViewData(id, data)
		if err != nil || view.Name != "before\ufeffafter" {
			t.Fatal("valid content BOM was changed", err)
		}
	}
	for _, data := range [][]byte{
		[]byte("\xef\xbb\xbf\xef\xbb\xbf{}"),
		[]byte(" \xef\xbb\xbf{}"),
		[]byte("\xef\xbb\xbf{broken"),
	} {
		if _, err := ParseAttributeViewData(id, data); err == nil {
			t.Fatalf("accepted invalid JSON: %x", data)
		}
	}
}

func TestAttributeViewBOMConditionalSave(t *testing.T) {
	setupCollectionIndexTest(t)
	view := &AttributeView{ID: "20261028120000-bomav00", Spec: PlainTextSpec}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	original := append([]byte{0xef, 0xbb, 0xbf}, raw...)
	path := GetAttributeViewDataPath(view.ID)
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	view, err = ParseAttributeView(view.ID)
	if err != nil {
		t.Fatal(err)
	}
	view.Name = "Conditional save"
	if err = SaveAttributeViewIfUnchanged(view, original); err != nil {
		t.Fatal(err)
	}
	if err = SaveAttributeViewIfUnchanged(view, original); !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("stale write accepted", err)
	}
}

func TestAttributeViewInvalidJSONReportsSource(t *testing.T) {
	setupCollectionIndexTest(t)
	const id = "20261028120000-bomav00"
	path := GetAttributeViewDataPath(id)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	invalid := []byte("\xef\xbb\xbf{broken")
	if err := os.WriteFile(path, invalid, 0600); err != nil {
		t.Fatal(err)
	}
	for name, read := range map[string]func() error{
		"full":       func() error { _, err := ParseAttributeView(id); return err },
		"search":     func() error { _, err := GetAttributeViewSearchInfoInBox(id, ""); return err },
		"collection": func() error { _, err := BlockCollectionIndexInBox(""); return err },
	} {
		if err := read(); err == nil || !strings.Contains(err.Error(), id) {
			t.Fatalf("%s omitted source: %v", name, err)
		}
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, invalid) {
		t.Fatal("invalid JSON was modified", err)
	}
}
