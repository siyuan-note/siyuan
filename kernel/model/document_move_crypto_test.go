// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentMoveEncryptedSubtreePreservesSourcesAndIndexes(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	target := createStructuredTitlesEncryptedDoc(t, box, nil, "Target &amp;")
	root := createStructuredTitlesEncryptedDoc(t, box, nil, "Root/one")
	child := createStructuredTitlesEncryptedDoc(t, box, &root.ID, "Child/two")
	empty := createStructuredTitlesEncryptedDoc(t, box, &root.ID, "Legacy empty title")
	// 新建入口会为留空的标题命名；这里模拟已有源中的空标题。
	emptyTree, _, err := filesys.ReadTreeSnapshot(box, empty.Path)
	if err != nil {
		t.Fatal(err)
	}
	emptyTree.Root.SetIALAttr("title", "")
	if _, err = filesys.WriteTree(emptyTree); err != nil {
		t.Fatal(err)
	}
	empty.Title = treenode.ReadDocumentTitle(emptyTree.Root)
	documents := []*treenode.DocumentPath{root, child, empty}
	sources := map[string][]byte{}
	for _, document := range documents {
		sources[document.ID] = structuredTitlesCiphertext(t, document)
	}
	for _, destination := range []string{target.Path, "/"} {
		if err := MoveDocs([]string{documents[0].Path}, box, destination, nil); err != nil {
			t.Fatal(err)
		}
		drainHPathRefreshTest(t)
		for i, previous := range documents {
			paths, missing, err := GetDocPaths(box, []string{previous.ID})
			if err != nil || len(paths) != 1 || len(missing) != 0 {
				t.Fatal("moved document disappeared", missing, err)
			}
			current := paths[0]
			expected := []string{"Root/one"}
			if i > 0 {
				expected = append(expected, previous.Title.Text)
			}
			if destination != "/" {
				expected = append([]string{"Target &amp;"}, expected...)
			}
			var titles []string
			for _, segment := range current.Segments {
				titles = append(titles, segment.Text)
			}
			if !reflect.DeepEqual(titles, expected) || current.Title.Text != previous.Title.Text {
				t.Fatalf("move changed literal titles or ancestry: %+v", current)
			}
			if _, err = os.Stat(filepath.Join(util.DataDir, box, previous.Path)); !os.IsNotExist(err) {
				t.Fatal("move retained its old source", err)
			}
			assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, current.Path), sources[current.ID])
			tree, _, err := filesys.ReadTreeSnapshot(box, current.Path)
			if err != nil {
				t.Fatal("moved ciphertext could not be authenticated", err)
			}
			assertHPathTestDoc(t, sql.GetEncryptedDB(box), tree, current.DisplayPath)
			if block := sql.GetBlockInBox(tree.Root.FirstChild.ID, box); block == nil || block.Path != current.Path || block.Content != "Encrypted content "+current.ID {
				t.Fatalf("descendant content index did not follow its source: %+v", block)
			}
			if sql.GetBlock(current.ID) != nil {
				t.Fatal("move exposed an encrypted title in the global index")
			}
			documents[i] = current
		}
		if pending, err := treenode.PendingDocumentMetadata(box); err != nil || len(pending) != 0 {
			t.Fatal("move did not finish metadata recovery", pending, err)
		}
	}
}
