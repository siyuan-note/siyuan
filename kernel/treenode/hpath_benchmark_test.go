// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// BenchmarkDocumentHPathRefresh 测量重命名父文档时的前台路径刷新，覆盖宽子树、深子树和加密索引。
func BenchmarkDocumentHPathRefresh(b *testing.B) {
	for _, encrypted := range []bool{false, true} {
		for _, size := range []int{1000, 10000} {
			for _, depth := range []int{2, 7} {
				b.Run(fmt.Sprintf("encrypted=%t/docs=%d/depth=%d", encrypted, size, depth), func(b *testing.B) {
					const boxID = "20261023000000-bench01"
					dsn := filepath.Join(b.TempDir(), "blocktree.db") + "?_journal_mode=WAL&_synchronous=OFF&_busy_timeout=7000"
					if encrypted {
						dsn += "&_key=x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'"
					}
					database, err := sql.Open("sqlite3_extended", dsn)
					if err != nil {
						b.Fatal(err)
					}
					previous := db
					b.Cleanup(func() {
						if encrypted {
							CloseEncryptedBlockTreeDB(boxID)
						} else {
							db = previous
						}
						database.Close()
					})
					if encrypted {
						if err = initEncryptedBlockTreeTables(database); err != nil {
							b.Fatal(err)
						}
						encryptedBlockTreeDBs.Store(boxID, database)
					} else {
						db = database
						initDBTables()
					}
					tx, err := database.Begin()
					if err != nil {
						b.Fatal(err)
					}
					defer tx.Rollback()
					var root, last *parse.Tree
					parentPath, parentHPath := "", ""
					for i := range size {
						id := fmt.Sprintf("20261023000000-%07d", i)
						title := fmt.Sprintf("Title %d", i)
						tree := NewTree(boxID, parentPath+"/"+id+".sy", parentHPath+"/"+title, title)
						execInsertBlocktrees(tx, tree, []*ast.Node{tree.Root})
						if i == 0 {
							root = tree
						}
						if i < depth-1 {
							parentPath, parentHPath = strings.TrimSuffix(tree.Path, ".sy"), tree.HPath
						}
						last = tree
					}
					if err = tx.Commit(); err != nil {
						b.Fatal(err)
					}
					var pages, pageSize int64
					if err = database.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
						b.Fatal(err)
					}
					if err = database.QueryRow("PRAGMA page_size").Scan(&pageSize); err != nil {
						b.Fatal(err)
					}
					b.ReportAllocs()
					iteration := 0
					for b.Loop() {
						title := fmt.Sprintf("Root %d", iteration%2)
						root.Root.SetIALAttr("title", title)
						root.HPath = "/" + title
						if err = RefreshDocHPaths(root); err != nil {
							b.Fatal(err)
						}
						iteration++
					}
					if doc := GetBlockTreeInExactBox(last.ID, boxID); doc == nil || !strings.HasPrefix(doc.HPath, root.HPath+"/") {
						b.Fatal("descendant display path was not refreshed")
					}
					b.ReportMetric(float64(pages*pageSize)/(1024*1024), "DB-MiB")
					b.ReportMetric(float64(size), "documents/op")
				})
			}
		}
	}
}
