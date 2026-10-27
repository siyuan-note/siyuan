// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import "testing"

func TestRefreshDefinitionRefsQueueUsesEncryptedDatabase(t *testing.T) {
	prepareIndexQueueTest(t)
	database, boxID := useEncryptedQueryTestDB(t)
	if _, err := database.Exec("INSERT INTO blocks (id, parent_id, root_id, box, path) VALUES ('definition', 'parent', 'new-root', ?, '/new-root.sy')", boxID); err != nil {
		t.Fatal(err)
	}
	insertEncryptedQueryTestRef(t, database, "reference", "definition", "old-root")
	RefreshDefinitionRefsQueue(boxID, []string{"definition", "deleted-definition"})
	operationQueue = nil
	recoverIndexQueue()
	FlushQueue()
	var parent, root, path string
	if err := database.QueryRow("SELECT def_block_parent_id, def_block_root_id, def_block_path FROM refs WHERE id = 'reference'").Scan(&parent, &root, &path); err != nil {
		t.Fatal(err)
	}
	if parent != "parent" || root != "new-root" || path != "/new-root.sy" || len(operationQueue) != 0 || len(loadIndexQueue()) != 0 {
		t.Fatalf("encrypted reference repair was not recovered: %q %q %q", parent, root, path)
	}
}
