// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeSnapshotDoesNotRecoverMissingParents(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, parent, childPath, plain := setupStalePathTest(t)
			provider, acquire, release := DEKProvider, DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = provider, acquire, release })
			original, err := encryptDataWithDEK(box, childPath, plain, dek)
			if err != nil {
				t.Fatal(err)
			}
			childAbs := writeStalePathFixture(t, box, childPath, original)
			parentAbs := filepath.Join(util.DataDir, box, parent+".sy")
			for _, load := range []func() error{
				func() error { _, _, e := LoadTreeSnapshot(box, childPath, util.NewLute()); return e },
				func() error { _, _, _, e := LoadTreeSnapshotWithFix(box, childPath, util.NewLute()); return e },
			} {
				if err = load(); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("missing parent did not make snapshot unavailable", err)
				}
				if _, err = os.Stat(parentAbs); !os.IsNotExist(err) {
					t.Fatal("snapshot created a missing parent", err)
				}
				if _, cached := cache.GetTreeDataInBox(parent, box); cached {
					t.Fatal("snapshot populated a synthetic parent cache entry")
				}
				current, readErr := os.ReadFile(childAbs)
				if readErr != nil || !bytes.Equal(current, original) {
					t.Fatal("snapshot changed its child source", readErr)
				}
			}
			loaded, err := LoadTree(box, childPath, util.NewLute())
			if err != nil || loaded.HPath != "/Untitled/Child" {
				t.Fatal("ordinary tree load no longer recovers a missing parent", err)
			}
			parentSource, err := os.ReadFile(parentAbs)
			if err != nil || util.IsCiphertext(parentSource) != encrypted {
				t.Fatal("ordinary parent recovery lost its native encryption format", err)
			}
		})
	}
}
