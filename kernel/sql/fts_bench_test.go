// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sql

// 本文件为 blocks_fts 改造为 FTS5 external-content 模式后的性能基准测试，量化写入/查询/重建开销。
// https://github.com/siyuan-note/siyuan/issues/17540
//
// 运行（需 fts5 build tag，FTS5 是可选编译）：
//
//	cd kernel
//	go test -vet=off -tags=fts5 -run=^$ -bench=BenchmarkFTS -benchmem -benchtime=5x ./sql/
//	go test -vet=off -tags=fts5 -run=TestFTSBenchStorage -v ./sql/
//
// 调整 genBlock 中正文段落的重复次数可在大小内容场景间切换。-vet=off 用于跳过 queue*.go 里
// 既有的、与本测试无关的 vet 警告。测试在临时数据库上执行，结束自动清理，不影响真实数据。

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// ftsBenchDB 封装一次基准测试的数据库句柄与 DDL 模式。
type ftsBenchDB struct {
	db   *sql.DB
	path string
	mode string // "standard" 或 "external"
}

// newFTSBenchDB 在临时路径创建数据库，并按指定模式建表。
func newFTSBenchDB(mode string) (*ftsBenchDB, error) {
	tmpDir, err := os.MkdirTemp("", "fts-bench-*")
	if err != nil {
		return nil, err
	}
	dbPath := filepath.Join(tmpDir, "bench.db")
	dsn := dbPath + "?_journal_mode=WAL&_synchronous=OFF&_cache_size=-128000&_page_size=32768&_busy_timeout=7000"
	// 使用内核注册的 sqlite3_extended 驱动（带 regexp 函数，且 fork 的 amalgamation 内置 FTS5 + siyuan 分词器）
	db, err := sql.Open("sqlite3_extended", dsn)
	if err != nil {
		os.RemoveAll(tmpDir)
		return nil, err
	}
	db.SetMaxOpenConns(1)

	b := &ftsBenchDB{db: db, path: tmpDir, mode: mode}
	if err = b.createTables(mode); err != nil {
		db.Close()
		os.RemoveAll(tmpDir)
		return nil, err
	}
	return b, nil
}

func (b *ftsBenchDB) close() {
	if b.db != nil {
		b.db.Close()
	}
	if b.path != "" {
		os.RemoveAll(b.path)
	}
}

// createTables 按指定模式创建 blocks 与 blocks_fts。
func (b *ftsBenchDB) createTables(mode string) error {
	_, err := b.db.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)")
	if err != nil {
		return err
	}
	_, err = b.db.Exec("CREATE INDEX idx_blocks_id ON blocks(id)")
	if err != nil {
		return err
	}
	_, err = b.db.Exec("CREATE INDEX idx_blocks_root_id ON blocks(root_id)")
	if err != nil {
		return err
	}

	cols := "id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath UNINDEXED, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED"
	var ddl string
	switch mode {
	case "standard":
		ddl = "CREATE VIRTUAL TABLE blocks_fts USING fts5(" + cols + ", tokenize=\"siyuan case_insensitive\")"
	case "external":
		ddl = "CREATE VIRTUAL TABLE blocks_fts USING fts5(" + cols + ", content='blocks', content_rowid='rowid', tokenize=\"siyuan case_insensitive\")"
	default:
		return fmt.Errorf("unknown mode: %s", mode)
	}
	_, err = b.db.Exec(ddl)
	return err
}

// createFTSTable 只重建 FTS 虚表（不动 blocks），用于 rebuild 基准测试。
func (b *ftsBenchDB) createFTSTable(mode string) error {
	if _, err := b.db.Exec("DROP TABLE IF EXISTS blocks_fts"); err != nil {
		return err
	}
	cols := "id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath UNINDEXED, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED"
	var ddl string
	switch mode {
	case "standard":
		ddl = "CREATE VIRTUAL TABLE blocks_fts USING fts5(" + cols + ", tokenize=\"siyuan case_insensitive\")"
	case "external":
		ddl = "CREATE VIRTUAL TABLE blocks_fts USING fts5(" + cols + ", content='blocks', content_rowid='rowid', tokenize=\"siyuan case_insensitive\")"
	default:
		return fmt.Errorf("unknown mode: %s", mode)
	}
	_, err := b.db.Exec(ddl)
	return err
}

// genBlock 生成一个用于基准测试的 block（content 含中英文长正文，模拟真实笔记段落）。
// 正文体量约 2KB，贴近真实长笔记，放大 external-content 省影子表写的收益。
func genBlock(i, root int) []any {
	para := "这是一段用于基准测试的中英文混排正文。SiYuan 是一款本地优先的个人知识管理系统，支持块级引用、双链、全文搜索与闪卡复习。" +
		"The quick brown fox jumps over the lazy dog. 代码示例：func main() { println(\"hello world\"); for i := 0; i < 10; i++ { go work(i) } }。" +
		"思源笔记使用 SQLite FTS5 提供全文检索能力，配合自定义的 siyuan 分词器处理中英文及 CJK 字符的逐字切分。"
	// 重复约 10 次凑到 ~2KB
	var bld strings.Builder
	for range 10 {
		bld.WriteString(para)
	}
	content := bld.String()
	return []any{
		fmt.Sprintf("%020d", i),          // id
		fmt.Sprintf("%020d", root),       // parent_id
		fmt.Sprintf("%020d", root),       // root_id
		fmt.Sprintf("hash%d", i),         // hash
		"20230201000",                    // box
		fmt.Sprintf("/p/%020d.sy", root), // path
		fmt.Sprintf("/文档%d", root),       // hpath
		fmt.Sprintf("块名%d", i),           // name
		"alias",                          // alias
		"memo",                           // memo
		"tag",                            // tag
		content,                          // content
		content,                          // fcontent
		fmt.Sprintf("markdown %d", i),    // markdown
		len(content),                     // length
		"p",                              // type
		"",                               // subtype
		"{: id=\"ial\"}",                 // ial
		i,                                // sort
		"20230101000000",                 // created
		"20230101000000",                 // updated
	}
}

// insertBlocksStandard 标准模式：成对写 blocks 与 blocks_fts（原 insertBlocks0 逻辑）。
func (b *ftsBenchDB) insertBlocksStandard(bulk [][]any) error {
	if len(bulk) == 0 {
		return nil
	}
	ph := "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	placeholderRows := make([]string, len(bulk))
	for i := range placeholderRows {
		placeholderRows[i] = ph
	}
	args := make([]any, 0, len(bulk)*21)
	for _, blk := range bulk {
		args = append(args, blk...)
	}
	joined := strings.Join(placeholderRows, ",")
	if _, err := b.db.Exec("INSERT INTO blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES "+joined, args...); err != nil {
		return err
	}
	if _, err := b.db.Exec("INSERT INTO blocks_fts (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES "+joined, args...); err != nil {
		return err
	}
	return nil
}

// insertBlocksExternal external-content 模式：插 blocks 后反查 rowid 再带 rowid 插 FTS。
func (b *ftsBenchDB) insertBlocksExternal(bulk [][]any) error {
	if len(bulk) == 0 {
		return nil
	}
	ph := "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	placeholderRows := make([]string, len(bulk))
	for i := range placeholderRows {
		placeholderRows[i] = ph
	}
	args := make([]any, 0, len(bulk)*21)
	for _, blk := range bulk {
		args = append(args, blk...)
	}
	joined := strings.Join(placeholderRows, ",")
	if _, err := b.db.Exec("INSERT INTO blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES "+joined, args...); err != nil {
		return err
	}

	// 反查 rowid（按 id 用 map 对齐）
	idList := make([]string, len(bulk))
	for i, blk := range bulk {
		idList[i] = "\"" + blk[0].(string) + "\""
	}
	rows, err := b.db.Query("SELECT id, ROWID FROM blocks WHERE id IN (" + strings.Join(idList, ",") + ")")
	if err != nil {
		return err
	}
	rowIDMap := map[string]int64{}
	for rows.Next() {
		var id string
		var rid int64
		if err = rows.Scan(&id, &rid); err != nil {
			rows.Close()
			return err
		}
		rowIDMap[id] = rid
	}
	rows.Close()

	// 拼 FTS 写入参数（首列 rowid）
	ftsPH := "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	ftsRows := make([]string, len(bulk))
	for i := range ftsRows {
		ftsRows[i] = ftsPH
	}
	ftsArgs := make([]any, 0, len(bulk)*22)
	for _, blk := range bulk {
		id := blk[0].(string)
		rid, ok := rowIDMap[id]
		if !ok {
			return fmt.Errorf("rowid not found for %s", id)
		}
		ftsArgs = append(ftsArgs, rid)
		ftsArgs = append(ftsArgs, blk...)
	}
	if _, err := b.db.Exec("INSERT INTO blocks_fts (rowid, id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES "+strings.Join(ftsRows, ","), ftsArgs...); err != nil {
		return err
	}
	return nil
}

// insertBatch 按模式分派插入。
func (b *ftsBenchDB) insertBatch(bulk [][]any) error {
	if b.mode == "external" {
		return b.insertBlocksExternal(bulk)
	}
	return b.insertBlocksStandard(bulk)
}

// rebuild 重建 FTS 索引（标准模式用 INSERT...SELECT，external 用 'rebuild'）。
func (b *ftsBenchDB) rebuild() error {
	if b.mode == "external" {
		_, err := b.db.Exec("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')")
		return err
	}
	_, err := b.db.Exec("INSERT INTO blocks_fts (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) SELECT id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated FROM blocks")
	return err
}

// queryFTS 执行一次带 snippet 的 FTS 搜索，返回命中行数，模拟 fullTextSearchByFTS。
func (b *ftsBenchDB) queryFTS(keyword string, limit int) (int, error) {
	stmt := "SELECT id, snippet(blocks_fts, 11, '__@mark__', '__mark@__', '...', 512) AS content, fcontent, markdown, type FROM blocks_fts WHERE blocks_fts MATCH '{content name tag}:(\"" + keyword + "\")' LIMIT " + strconv.Itoa(limit)
	rows, err := b.db.Query(stmt)
	if err != nil {
		return 0, err
	}
	count := 0
	for rows.Next() {
		count++
		var id, content, fcontent, markdown, typ string
		rows.Scan(&id, &content, &fcontent, &markdown, &typ)
	}
	return count, rows.Err()
}

// seedData 在指定模式下填充 nRoots × nBlocksPerRoot 个块。
func (b *ftsBenchDB) seedData(nRoots, nBlocksPerRoot int, batch int) error {
	var bulk [][]any
	idx := 0
	for r := range nRoots {
		for range nBlocksPerRoot {
			bulk = append(bulk, genBlock(idx, r))
			idx++
			if len(bulk) >= batch {
				if err := b.insertBatch(bulk); err != nil {
					return err
				}
				bulk = bulk[:0]
			}
		}
	}
	if len(bulk) > 0 {
		if err := b.insertBatch(bulk); err != nil {
			return err
		}
	}
	return nil
}

// dbFileSize 返回数据库文件大小（字节）。
func (b *ftsBenchDB) dbFileSize() (int64, error) {
	entries, err := os.ReadDir(b.path)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		total += info.Size()
	}
	return total, nil
}

// benchSize 控制基准测试的数据规模：可在编译时用 -ldflags 调整，这里给一个默认值。
const benchRoots = 50
const benchBlocksPerRoot = 100 // 共 5000 块

// BenchmarkFTSInsert 对比两种模式的批量 INSERT 性能。
func BenchmarkFTSInsertStandard(b *testing.B) {
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		db, err := newFTSBenchDB("standard")
		if err != nil {
			b.Fatal(err)
		}
		b.StartTimer()
		if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
			db.close()
			b.Fatal(err)
		}
		b.StopTimer()
		db.close()
		b.StartTimer()
	}
}

func BenchmarkFTSInsertExternal(b *testing.B) {
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		db, err := newFTSBenchDB("external")
		if err != nil {
			b.Fatal(err)
		}
		b.StartTimer()
		if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
			db.close()
			b.Fatal(err)
		}
		b.StopTimer()
		db.close()
		b.StartTimer()
	}
}

// BenchmarkFTSRebuild 对比两种模式的 FTS 索引重建性能。
func BenchmarkFTSRebuildStandard(b *testing.B) {
	db, err := newFTSBenchDB("standard")
	if err != nil {
		b.Fatal(err)
	}
	defer db.close()
	if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
		b.Fatal(err)
	}
	// 先 DROP FTS 再重建，模拟 RebuildFTSIndex（blocks 表保留不动）
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := db.createFTSTable("standard"); err != nil {
			b.Fatal(err)
		}
		if err := db.rebuild(); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkFTSRebuildExternal(b *testing.B) {
	db, err := newFTSBenchDB("external")
	if err != nil {
		b.Fatal(err)
	}
	defer db.close()
	if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := db.createFTSTable("external"); err != nil {
			b.Fatal(err)
		}
		if err := db.rebuild(); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkFTSQuery 对比两种模式的搜索查询性能（含 snippet 回表开销）。
// 数据预填充，只测查询本身。
func benchFTSQuery(b *testing.B, mode, keyword string) {
	db, err := newFTSBenchDB(mode)
	if err != nil {
		b.Fatal(err)
	}
	defer db.close()
	if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := db.queryFTS(keyword, 50); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkFTSQueryChineseStandard(b *testing.B) { benchFTSQuery(b, "standard", "中文") }
func BenchmarkFTSQueryChineseExternal(b *testing.B) { benchFTSQuery(b, "external", "中文") }
func BenchmarkFTSQueryEnglishStandard(b *testing.B) { benchFTSQuery(b, "standard", "code") }
func BenchmarkFTSQueryEnglishExternal(b *testing.B) { benchFTSQuery(b, "external", "code") }

// TestFTSBenchStorage 是普通测试（非 benchmark），打印两种模式下的数据库文件大小对比。
func TestFTSBenchStorage(t *testing.T) {
	for _, mode := range []string{"standard", "external"} {
		db, err := newFTSBenchDB(mode)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.seedData(benchRoots, benchBlocksPerRoot, 512); err != nil {
			db.close()
			t.Fatal(err)
		}
		size, _ := db.dbFileSize()
		t.Logf("[%s] 数据库文件总大小: %d 字节 (%.2f MB)，共 %d 块", mode, size, float64(size)/1024/1024, benchRoots*benchBlocksPerRoot)
		db.close()
	}
}
