// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"

	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type ftsCountKey struct {
	database   *sql.DB
	connection *sqlite3.SQLiteConn
	version    [3]int64
	query      [32]byte
}

type ftsCountEntry struct {
	key           ftsCountKey
	matches, docs int
	used          uint64
}

// 固定槽位不保留查询正文，包含连接身份、原生版本和参数指纹，总保留空间低于 128 KiB。
var ftsCounts = struct {
	sync.Mutex
	entries    [128][4]ftsCountEntry
	clock      uint64
	generation uint64
}{}

func clearFTSCountCache() {
	ftsCounts.Lock()
	defer ftsCounts.Unlock()
	ftsCounts.entries = [128][4]ftsCountEntry{}
	ftsCounts.generation++
}

func ftsCountGeneration() uint64 {
	ftsCounts.Lock()
	defer ftsCounts.Unlock()
	return ftsCounts.generation
}

func getFTSCount(key ftsCountKey, generation uint64) (matches, docs int, found bool) {
	ftsCounts.Lock()
	defer ftsCounts.Unlock()
	if generation != ftsCounts.generation {
		return
	}
	bucket := &ftsCounts.entries[int(key.query[0])%len(ftsCounts.entries)]
	for i := range bucket {
		entry := &bucket[i]
		if entry.used != 0 && entry.key == key {
			ftsCounts.clock++
			entry.used = ftsCounts.clock
			return entry.matches, entry.docs, true
		}
	}
	return
}

func setFTSCount(key ftsCountKey, generation uint64, matches, docs int) {
	ftsCounts.Lock()
	defer ftsCounts.Unlock()
	if generation != ftsCounts.generation {
		return
	}
	bucket := &ftsCounts.entries[int(key.query[0])%len(ftsCounts.entries)]
	slot := 0
	for i, entry := range bucket {
		if entry.used == 0 || entry.key == key {
			slot = i
			break
		}
		if entry.used < bucket[slot].used {
			slot = i
		}
	}
	ftsCounts.clock++
	bucket[slot] = ftsCountEntry{key: key, matches: matches, docs: docs, used: ftsCounts.clock}
}

// SelectFTSBlocksWithCountContext 在同一普通库读取快照内取得分页行及精确计数。
// 仅供固定 FTS 查询使用；加密库、自定义 SQL 和动态忽略条件使用各自的既有路径。
func SelectFTSBlocksWithCountContext(ctx context.Context, statement, countStatement string, args []any) (blocks []*Block, matches, docs int, err error) {
	if err = ctx.Err(); err != nil {
		return
	}
	if !checkRawBlockQueryStmt(statement, "") || !checkRawBlockQueryStmt(countStatement, "") {
		return nil, 0, 0, errors.New("unsupported FTS read statement")
	}
	database := db
	if database == nil {
		return nil, 0, 0, errors.New("database is nil")
	}
	connection, err := database.Conn(ctx)
	if err != nil {
		return
	}
	defer connection.Close()
	key := ftsCountKey{database: database}
	cacheable := true
	if err = connection.Raw(func(raw any) error {
		var supported bool
		key.connection, supported = raw.(*sqlite3.SQLiteConn)
		cacheable = supported
		return nil
	}); err != nil {
		return
	}
	stringArgs := make([]string, len(args))
	for i, argument := range args {
		value, ok := argument.(string)
		if !ok {
			cacheable = false
		}
		stringArgs[i] = value
	}
	encoded, marshalErr := json.Marshal(struct {
		Query string
		Args  []string
	}{countStatement, stringArgs})
	if marshalErr != nil {
		cacheable = false
	}
	key.query = sha256.Sum256(encoded)
	generation := ftsCountGeneration()
	timing := util.BeginPerformance("search.snapshot")
	defer timing.Finish()
	key.version, err = ftsReadVersion(ctx, connection)
	if err != nil {
		return
	}
	transaction, err := connection.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return
	}
	defer transaction.Rollback()
	// 先建立实际 B-tree 读取快照，再在同一连接上采集版本，避免将新计数标记成旧版本。
	var schemaObjects int
	if err = transaction.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_schema").Scan(&schemaObjects); err != nil {
		return
	}
	confirmedVersion, err := ftsReadVersion(ctx, transaction)
	if err != nil {
		return
	}
	cacheable = cacheable && key.version == confirmedVersion
	timing.Stage("rows")
	rows, err := transaction.QueryContext(ctx, statement, args...)
	if err != nil {
		return
	}
	for rows.Next() {
		if err = ctx.Err(); err != nil {
			rows.Close()
			return nil, 0, 0, err
		}
		block := scanBlockRows(rows)
		if block == nil {
			rows.Close()
			return nil, 0, 0, errors.New("invalid FTS block row")
		}
		blocks = append(blocks, block)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return
	}
	timing.Stage("count")
	if cacheable {
		if cachedMatches, cachedDocs, found := getFTSCount(key, generation); found {
			timing.Count("count_cache_hit", 1)
			return blocks, cachedMatches, cachedDocs, ctx.Err()
		}
	}
	if err = transaction.QueryRowContext(ctx, countStatement, args...).Scan(&matches, &docs); err != nil {
		return
	}
	if err = ctx.Err(); err == nil && cacheable {
		setFTSCount(key, generation, matches, docs)
	}
	return
}

type ftsVersionReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func ftsReadVersion(ctx context.Context, reader ftsVersionReader) (version [3]int64, err error) {
	err = reader.QueryRowContext(ctx, "SELECT data_version, total_changes(), schema_version FROM pragma_data_version, pragma_schema_version").Scan(&version[0], &version[1], &version[2])
	return
}
