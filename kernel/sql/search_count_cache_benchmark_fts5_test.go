// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"context"
	"fmt"
	"testing"
)

func BenchmarkFTSExactCountReuse(b *testing.B) {
	previousDB := db
	b.Cleanup(func() { db = previousDB; clearFTSCountCache() })
	for _, size := range []int{1000, 10000, 100000, 1000000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			db = newDeletePathTestDB(b, false)
			statement := `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x+1<?)
INSERT INTO blocks (` + ftsCountTestFields + `)
SELECT printf('%023d',x),'',printf('%023d',x/100),'','box','/doc.sy','/doc','','','','',
CASE WHEN x%1000=0 THEN 'common rare' ELSE 'common' END,'','',6,'p','','',0,'20261019000000','20261019000000' FROM n`
			if _, err := db.Exec(statement, size); err != nil {
				b.Fatal(err)
			}
			if _, err := db.Exec("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')"); err != nil {
				b.Fatal(err)
			}
			for _, term := range []string{"common", "rare", "absent"} {
				for _, mode := range []string{"uncached", "cold", "reused"} {
					b.Run(term+"/"+mode, func(b *testing.B) {
						ctx := context.Background()
						query := "SELECT " + ftsCountTestFields + " FROM blocks_fts WHERE blocks_fts MATCH ? LIMIT 50"
						count := "SELECT COUNT(id) AS matches,COUNT(DISTINCT root_id) AS docs FROM blocks_fts WHERE blocks_fts MATCH ?"
						args := []any{"content:(" + term + ")"}
						want := size
						if term == "rare" {
							want = (size + 999) / 1000
						} else if term == "absent" {
							want = 0
						}
						clearFTSCountCache()
						if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, query, count, args); err != nil || matches != want {
							b.Fatalf("invalid fixture: matches=%d, %v", matches, err)
						}
						b.ReportAllocs()
						b.ResetTimer()
						for range b.N {
							if mode == "uncached" {
								blocks, err := SelectBlocksRawStmtArgsInBoxContext(ctx, query, args, 50, "")
								counts, countErr := QueryNoLimitArgsInBoxContext(ctx, count, "", args...)
								if err != nil || countErr != nil || len(blocks) != min(want, 50) || len(counts) != 1 || counts[0]["matches"] != int64(want) {
									b.Fatalf("unexpected uncached result: %v, %v", err, countErr)
								}
							} else {
								if mode == "cold" {
									clearFTSCountCache()
								}
								blocks, matches, _, err := SelectFTSBlocksWithCountContext(ctx, query, count, args)
								if err != nil || matches != want || len(blocks) != min(want, 50) {
									b.Fatalf("unexpected snapshot result: matches=%d, %v", matches, err)
								}
							}
						}
					})
				}
			}
		})
	}
}
