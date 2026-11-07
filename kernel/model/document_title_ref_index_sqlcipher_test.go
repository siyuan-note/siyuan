// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedDocumentTitleDeferredIndexPropagation(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "deferred-title-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Deferred titles", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	drainDocumentTitleIndexTasks(t)
	backgroundRefreshWaitGroup.Wait()
	testDocumentTitleDeferredIndexPropagation(t, boxID)
	t.Run("locked notebook retains pending refresh", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		ref.Root.DocumentTitle = testDynamicTitle(t, ref.ID, "Ref ", base.ID).DocumentTitle
		if _, err = refreshDocumentTitleAnchors(ref.Root, ref); err != nil {
			t.Fatal(err)
		}
		if err = indexWriteTreeUpsertQueue(ref); err != nil {
			t.Fatal(err)
		}
		base.Root.SetIALAttr("title", "After")
		if err = indexWriteTreeUpsertQueue(base); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		updateRefTextRenameDoc(base)
		key := dynamicRefTextRetryKey{boxID, base.ID}
		encryption, err := GetBoxEncryption(boxID)
		if err != nil {
			t.Fatal(err)
		}
		Unmount(boxID)
		flushUpdateRefTextRenameDoc()
		if _, pending := updateRefTextRenameDocs[key]; !pending || sql.GetEncryptedDB(boxID) != nil {
			t.Fatal("deferred refresh discarded its key or reopened the locked notebook")
		}
		if err = UnlockBox(boxID, password, encryption); err != nil {
			t.Fatal(err)
		}
		if _, err = Mount(boxID); err != nil {
			t.Fatal(err)
		}
		drainDocumentTitleIndexTasks(t)
		sql.FlushQueue()
		FlushUpdateRefTextRenameDocJob()
		current, err := filesys.LoadTree(boxID, ref.Path, util.NewLute())
		if err != nil || treenode.ReadDocumentTitle(current.Root).Text != "Ref After" {
			t.Fatalf("unlock did not finish deferred refresh: %v", err)
		}
		if len(updateRefTextRenameDocs) != 0 {
			t.Fatal("successful encrypted refresh remained queued")
		}
	})
}
