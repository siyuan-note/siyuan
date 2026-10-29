// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
)

func withDocumentMetadataDB(t *testing.T, encrypted bool) string {
	t.Helper()
	const boxID = "20261023000000-metabox"
	dsn := filepath.Join(t.TempDir(), "blocktree.db")
	if encrypted {
		dsn += "?_key=x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'"
	}
	database, err := sql.Open("sqlite3_extended", dsn)
	if err != nil {
		t.Fatal(err)
	}
	previousDB := db
	if encrypted {
		if err = initEncryptedBlockTreeTables(database); err != nil {
			t.Fatal(err)
		}
		encryptedBlockTreeDBs.Store(boxID, database)
	} else {
		db = database
		initDBTables()
	}
	t.Cleanup(func() {
		if encrypted {
			CloseEncryptedBlockTreeDB(boxID)
		} else {
			db = previousDB
			database.Close()
		}
	})
	return boxID
}

func TestDocumentMetadataReadsUseIdentityIndex(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			rows, err := queryForBox(box, "EXPLAIN QUERY PLAN "+documentMetadataByIDQuery, box, "doc")
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var plan strings.Builder
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan.WriteString(detail + "\n")
			}
			if err = rows.Err(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(plan.String(), "SEARCH b USING INDEX idx_blocktrees_id (id=?)") ||
				!strings.Contains(plan.String(), "SEARCH m USING INDEX sqlite_autoindex_document_metadata_1 (box_id=? AND id=?)") {
				t.Fatalf("single document lookup scans unrelated documents: %s", plan.String())
			}
		})
	}
}

func TestDocumentMetadataIdentityAndTitle(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			root := NewTree(box, "/20261023000001-root001.sy", "/A", "A")
			child := NewTree(box, "/20261023000001-root001/20261023000002-child01.sy", "/A/B", "B")
			slash := NewTree(box, "/20261023000003-slash01.sy", "/A/B", "A/B")
			for _, tree := range []*parse.Tree{root, child, slash} {
				UpsertBlockTree(tree)
			}
			get := func(tree *parse.Tree) *DocumentPath {
				t.Helper()
				ret, err := GetDocumentPath(box, tree.ID, "", 1)
				if err != nil {
					t.Fatal(err)
				}
				return ret
			}
			childPath, slashPath := get(child), get(slash)
			if childPath.DisplayPath != slashPath.DisplayPath || childPath.Depth != 2 || slashPath.Depth != 1 ||
				childPath.ParentID == nil || *childPath.ParentID != root.ID || slashPath.ParentID != nil {
				t.Fatalf("display path changed identity: %+v, %+v", childPath, slashPath)
			}
			previousRevision := childPath.Revision
			root.Root.SetIALAttr("title", "**A／%2F&amp;**")
			root.HPath = "/**A／%2F&amp;**"
			if err := RefreshDocHPaths(root); err != nil {
				t.Fatal(err)
			}
			childPath = get(child)
			if childPath.Revision == previousRevision || childPath.Segments[0].Text != "**A／%2F&amp;**" ||
				GetBlockTreeInExactBox(child.ID, box).HPath != "/**A／%2F&amp;**/B" {
				t.Fatalf("rename did not retain literal title or revision: %+v", childPath)
			}
			// 空标题标志在秒级更新时间未变时也更新，实际占位文字不被抹掉。
			child.Root.SetIALAttr(DocumentTitleEmptyAttr, "true")
			UpsertBlockTree(child)
			childPath = get(child)
			if !childPath.Title.Empty || childPath.Title.Text != "B" || !childPath.Segments[1].Empty {
				t.Fatalf("lost empty title flag: %+v", childPath)
			}
			// 移动与删除都同步清理父身份，不留下可再次匹配的旧行。
			RemoveBlockTreesByRootID(box, child.ID)
			child.Path = "/" + child.ID + ".sy"
			child.HPath = "/B"
			UpsertBlockTree(child)
			if moved := get(child); moved.Depth != 1 || moved.ParentID != nil {
				t.Fatalf("move retained old parent: %+v", moved)
			}
			RemoveBlockTree(box, child.ID)
			if _, err := GetDocumentMetadata(box, child.ID); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("delete retained metadata: %v", err)
			}
			if _, err := GetDocumentPath("20261023000009-other01", root.ID, "", 1); err == nil {
				t.Fatal("read crossed notebook ownership")
			}
		})
	}
}

func TestDocumentMetadataMissingAndNotebookRoot(t *testing.T) {
	box := withDocumentMetadataDB(t, false)
	tree := NewTree(box, "/"+box+".sy", "/Notebook", "Notebook")
	UpsertBlockTree(tree)
	root, err := GetDocumentPath(box, tree.ID, box, 1)
	if err != nil || root.Depth != 0 || len(root.Segments) != 0 || root.DisplayPath != "/" {
		t.Fatalf("notebook document is not logical root: %+v, %v", root, err)
	}
	if _, err = db.Exec("DELETE FROM document_metadata"); err != nil {
		t.Fatal(err)
	}
	missing, err := MissingDocumentMetadata(box)
	if err != nil || len(missing) != 1 || missing[0].ID != box {
		t.Fatalf("missing metadata not discoverable: %+v, %v", missing, err)
	}
	if err = RecoverDocumentMetadata(tree); err != nil {
		t.Fatal(err)
	}
	meta, err := GetDocumentMetadata(box, tree.ID)
	if err != nil || !reflect.DeepEqual(meta.Title, ReadDocumentTitle(tree.Root)) || meta.SourceSpec != tree.Root.Spec {
		t.Fatalf("recovery lost source fields: %+v, %v", meta, err)
	}
	// 恢复任务读取后发生的新编辑优先，不能用旧源摘要覆盖。
	tree.Root.SetIALAttr("title", "Edited")
	UpsertBlockTree(tree)
	tree.Root.SetIALAttr("title", "Old snapshot")
	if err = RecoverDocumentMetadata(tree); err != nil {
		t.Fatal(err)
	}
	meta, _ = GetDocumentMetadata(box, tree.ID)
	if meta.Title.Text != "Edited" {
		t.Fatalf("recovery overwrote concurrent edit: %+v", meta)
	}
}

func TestDocumentMetadataPendingWrite(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			tree := NewTree(box, "/20261023000001-root001.sy", "/Saved", "Saved")
			UpsertBlockTree(tree)
			if err := SetDocumentMetadataState(box, "ready"); err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("title", "Not yet saved")
			UpsertBlockTreePending(tree)
			meta, err := GetDocumentMetadata(box, tree.ID)
			if err != nil || meta.Title.Text != "Saved" {
				t.Fatalf("editing transaction published an uncommitted title: %+v, %v", meta, err)
			}
			pending, err := BeginDocumentMetadataWrite(tree)
			if err != nil || !pending || DocumentMetadataState(box) != "building" {
				t.Fatalf("missing durable write intent: pending=%v err=%v", pending, err)
			}
			if err = SetDocumentMetadataState(box, "ready"); !errors.Is(err, ErrDocumentMetadataUnavailable) {
				t.Fatal("pending source write was advertised as ready", err)
			}
			intents, err := PendingDocumentMetadata(box)
			if err != nil || len(intents) != 1 || intents[0].Path != tree.Path {
				t.Fatalf("write cannot be recovered: %+v, %v", intents, err)
			}
			if err = CommitDocumentMetadataWrite(tree); err != nil {
				t.Fatal(err)
			}
			meta, err = GetDocumentMetadata(box, tree.ID)
			if err != nil || meta.Title.Text != "Not yet saved" || DocumentMetadataState(box) != "ready" {
				t.Fatalf("successful save did not publish its source: %+v, %v", meta, err)
			}
			if pending, err = BeginDocumentMetadataWrite(tree); err != nil || pending {
				t.Fatal("unchanged title writes an unnecessary intent", pending, err)
			}
		})
	}
}
