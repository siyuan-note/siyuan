// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexMutationsPreserveUnreadableData(t *testing.T) {
	previousDataDir := util.DataDir
	previousProvider, previousBoxes := AVDEKProvider, AVEncryptedBoxIDs
	previousAcquire, previousRelease := AVLockAcquire, AVLockRelease
	util.DataDir = t.TempDir()
	AVLockAcquire, AVLockRelease = nil, nil
	key := bytes.Repeat([]byte{0x42}, 32)
	AVDEKProvider = func(string) ([]byte, error) { return key, nil }
	boxID := ast.NewNodeID()
	AVEncryptedBoxIDs = func() []string { return []string{boxID} }
	t.Cleanup(func() {
		util.DataDir = previousDataDir
		AVDEKProvider, AVEncryptedBoxIDs = previousProvider, previousBoxes
		AVLockAcquire, AVLockRelease = previousAcquire, previousRelease
	})
	for _, scope := range []string{"", boxID} {
		t.Run(scope, func(t *testing.T) {
			avID, srcID, blockID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
			if scope != "" {
				SetAVBoxID(avID, scope)
				SetAVBoxID(srcID, scope)
				t.Cleanup(func() { SetAVBoxID(avID, ""); SetAVBoxID(srcID, "") })
			}
			for _, id := range []string{avID, srcID} {
				p := attributeViewDataPathByBox(id, scope)
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte("{}"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			for _, tc := range []struct {
				name, path string
				mutate     func()
			}{
				{"relation upsert", relationsPath(scope), func() { UpsertAvBackRel(srcID, avID) }},
				{"relation remove", relationsPath(scope), func() { RemoveAvRel(srcID, avID) }},
				{"mirror upsert", mirrorBlocksPath(scope), func() { UpsertBlockRel(avID, blockID) }},
				{"mirror batch", mirrorBlocksPath(scope), func() {
					BatchUpsertBlockRel([]*ast.Node{{Type: ast.NodeAttributeView, ID: blockID, AttributeViewID: avID}})
				}},
				{"mirror remove", mirrorBlocksPath(scope), func() { RemoveBlockRel(avID, blockID, func(string) bool { return true }) }},
			} {
				t.Run(tc.name, func(t *testing.T) {
					for _, invalid := range [][]byte{[]byte("invalid"), {0xc0}, {0x81, 0xa1, 'x', 0x92, 0xa1, 'y'}} {
						if err := os.WriteFile(tc.path, invalid, 0644); err != nil {
							t.Fatal(err)
						}
						tc.mutate()
						if actual, err := os.ReadFile(tc.path); err != nil || !bytes.Equal(actual, invalid) {
							t.Fatalf("failed read replaced original index: %x, %v", actual, err)
						}
					}
				})
			}
		})
	}
}

func TestRelationReadDistinguishesMissingAndInvalidIndex(t *testing.T) {
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDataDir })
	const avID = "20261027000000-av00001"
	if ids, err := GetSrcAvIDsWithErr(avID); err != nil || len(ids) != 0 {
		t.Fatalf("missing index is not empty: %v %v", ids, err)
	}
	p := relationsPath("")
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("invalid"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSrcAvIDsWithErr(avID); err == nil {
		t.Fatal("invalid index was accepted")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(p, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSrcAvIDsWithErr(avID); err == nil {
		t.Fatal("unreadable index was accepted")
	}
}
