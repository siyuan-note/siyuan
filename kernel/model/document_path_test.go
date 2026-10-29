// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestDocumentRenameUsesStorageParentIdentity(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree := treenode.NewTree(fixture.box.ID, fixture.sourcePath, "/Old/title", "Old/title")
	if _, _, err := prepareDocRename(tree, "New"); err != nil || tree.HPath != "/New" {
		t.Fatalf("root title was mistaken for hierarchy: %q, %v", tree.HPath, err)
	}
	parent := treenode.NewTree(fixture.box.ID, fixture.targetPath, "/Parent/title", "Parent/title")
	treenode.UpsertBlockTree(parent)
	tree.Path, tree.HPath = "/"+parent.ID+fixture.sourcePath, "/Parent/title/New"
	if _, _, err := prepareDocRename(tree, "Again"); err != nil || tree.HPath != "/Parent/title/Again" {
		t.Fatalf("parent identity or literal display text was lost: %q, %v", tree.HPath, err)
	}
}
