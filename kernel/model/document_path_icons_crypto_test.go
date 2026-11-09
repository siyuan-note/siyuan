// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentPathIconsEncryptedNotebookIsolation(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	encryptedBox := newStructuredTitlesEncryptedBox(t)
	parent := createStructuredTitlesEncryptedDoc(t, encryptedBox, nil, "Parent")
	child := createStructuredTitlesEncryptedDoc(t, encryptedBox, &parent.ID, "Child")
	for _, document := range []*treenode.DocumentPath{parent, child} {
		tree, err := filesys.LoadTree(encryptedBox, document.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("icon", "private-"+document.ID)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
	}
	plainBox := &Box{ID: "20261023010003-plain01"}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Plain", false
	if err := plainBox.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	for _, document := range []*treenode.DocumentPath{parent, child} {
		tree := treenode.NewTree(plainBox.ID, document.Path, document.DisplayPath, document.Title.Text)
		tree.Root.SetIALAttr("icon", "public-"+document.ID)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	if err := treenode.SetDocumentMetadataState(plainBox.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ box, prefix string }{{encryptedBox, "private-"}, {plainBox.ID, "public-"}} {
		documents, missing, icons, err := GetDocPathsWithIcons(item.box, []string{child.ID, child.ID}, true)
		if err != nil || len(documents) != 1 || len(missing) != 0 || len(icons) != 2 || icons[parent.ID] != item.prefix+parent.ID || icons[child.ID] != item.prefix+child.ID {
			t.Fatalf("notebook-scoped icons changed: documents=%+v missing=%v icons=%v err=%v", documents, missing, icons, err)
		}
		before, _, err := GetDocPaths(item.box, []string{child.ID})
		if err != nil || before[0].Revision != documents[0].Revision {
			t.Fatal("icon reads changed path revisions", err)
		}
	}
	LockBox(encryptedBox)
	if _, _, icons, err := GetDocPathsWithIcons(encryptedBox, []string{child.ID}, true); err == nil || icons != nil {
		t.Fatal("locked notebook exposed icons", icons, err)
	}
	if _, _, icons, err := GetDocPathsWithIcons(plainBox.ID, []string{child.ID}, true); err != nil || icons[child.ID] != "public-"+child.ID {
		t.Fatal("locking another notebook changed public icon", icons, err)
	}
}
