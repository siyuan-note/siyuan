// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexFixEncryptedRootRecreation(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	for _, failure := range []string{"created", "source-removed", "success"} {
		t.Run(failure, func(t *testing.T) {
			box := newStructuredTitlesEncryptedBox(t)
			root := createStructuredTitlesEncryptedDoc(t, box, nil, "Root")
			child := createStructuredTitlesEncryptedDoc(t, box, &root.ID, "Child")
			tree, original, err := filesys.LoadTreeSnapshot(box, root.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			childData := structuredTitlesCiphertext(t, child)
			injected := errors.New("injected encrypted root recreation failure")
			err = recreateTreeWithSteps(tree, filepath.Join(util.DataDir, box, root.Path), original, func(stage string) error {
				if stage == "created" {
					journals, readErr := readDocumentSourceJournals()
					if readErr != nil || len(journals) != 1 || !util.IsCiphertext(journals[0].Files[0].Before) || !util.IsCiphertext(journals[0].Files[1].After) {
						t.Fatalf("encrypted recovery record did not retain ciphertext: %v", readErr)
					}
				}
				if stage == failure {
					return injected
				}
				return nil
			})
			if failure != "success" {
				if !errors.Is(err, injected) {
					t.Fatal(err)
				}
				assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, root.Path), original)
				assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, child.Path), childData)
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if _, statErr := os.Stat(filepath.Join(util.DataDir, box, root.Path)); !os.IsNotExist(statErr) {
					t.Fatal("encrypted recreation retained old source", statErr)
				}
				movedPath := "/" + tree.ID + "/" + child.ID + ".sy"
				assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, movedPath), childData)
				if _, _, err = filesys.ReadTreeSnapshot(box, tree.Path); err != nil {
					t.Fatal("recreated ciphertext did not authenticate", err)
				}
				if _, _, err = filesys.ReadTreeSnapshot(box, movedPath); err != nil {
					t.Fatal("moved child ciphertext did not authenticate", err)
				}
			}
		})
	}
}
