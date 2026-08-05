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

import (
	"bytes"
	"database/sql"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
)

func GetRefDuplicatedDefRootIDs() (ret []string) {
	rows, err := query("SELECT DISTINCT def_block_root_id FROM `refs` GROUP BY def_block_id, def_block_root_id, block_id HAVING COUNT(*) > 1")
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ret = append(ret, id)
	}
	return
}

func QueryVirtualRefKeywords(name, alias, anchor, doc bool, searchIgnoreLines, refSearchIgnoreLines []string, boxIDs ...string) (ret []string) {
	boxID := ""
	if len(boxIDs) > 0 {
		boxID = boxIDs[0]
	}
	if name {
		ret = append(ret, queryNames(searchIgnoreLines, boxID)...)
	}
	if alias {
		ret = append(ret, queryAliases(searchIgnoreLines, boxID)...)
	}
	if anchor {
		ret = append(ret, queryRefTexts(refSearchIgnoreLines, boxID)...)
	}
	if doc {
		ret = append(ret, queryDocTitles(searchIgnoreLines, boxID)...)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) >= len(ret[j])
	})
	return
}

func queryRefTexts(refSearchIgnoreLines []string, boxIDs ...string) (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT DISTINCT content FROM refs WHERE 1 = 1"
	buf := bytes.Buffer{}
	for _, line := range refSearchIgnoreLines {
		buf.WriteString(" AND ")
		buf.WriteString(line)
	}
	sqlStmt += buf.String()
	sqlStmt += " LIMIT 10240"
	boxID := ""
	if len(boxIDs) > 0 {
		boxID = boxIDs[0]
	}
	rows, err := queryForBox(boxID, sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()

	set := hashset.New()
	for rows.Next() {
		var refText string
		rows.Scan(&refText)
		if "" == strings.TrimSpace(refText) {
			continue
		}
		set.Add(refText)
	}
	for _, refText := range set.Values() {
		ret = append(ret, refText.(string))
	}
	return
}

func QueryRefCount(defIDs []string) (ret map[string]int) {
	ret = map[string]int{}
	ids := strings.Join(defIDs, "','")
	ids = "('" + ids + "')"
	rows, err := query("SELECT def_block_id, COUNT(*) AS ref_cnt FROM refs WHERE def_block_id IN " + ids + " GROUP BY def_block_id")
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

// ExistRefByDefIDsInBox 检查指定笔记本索引中是否存在来自删除集合外部的引用。
func ExistRefByDefIDsInBox(defIDs, defRootIDs, excludeBlockIDs, excludeRootIDs []string, boxID string) (ret bool, err error) {
	const batchSize = 900

	defIDs = filterNonEmptyRefCheckIDs(defIDs)
	defRootIDs = filterNonEmptyRefCheckIDs(defRootIDs)
	excludeBlockIDs = filterNonEmptyRefCheckIDs(excludeBlockIDs)
	excludeRootIDs = filterNonEmptyRefCheckIDs(excludeRootIDs)
	excludeBlockIDSet := map[string]struct{}{}
	for _, id := range excludeBlockIDs {
		excludeBlockIDSet[id] = struct{}{}
	}
	excludeRootIDSet := map[string]struct{}{}
	for _, id := range excludeRootIDs {
		excludeRootIDSet[id] = struct{}{}
	}
	exist := func(column string, ids []string) (bool, error) {
		for start := 0; start < len(ids); start += batchSize {
			end := start + batchSize
			if len(ids) < end {
				end = len(ids)
			}
			batch := ids[start:end]
			placeholders := strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")
			args := make([]any, 0, len(batch))
			for _, id := range batch {
				args = append(args, id)
			}
			rows, queryErr := queryForBox(boxID, "SELECT block_id, root_id FROM refs WHERE "+column+" IN ("+placeholders+")", args...)
			if queryErr != nil {
				return false, queryErr
			}
			for rows.Next() {
				var blockID, rootID string
				if scanErr := rows.Scan(&blockID, &rootID); scanErr != nil {
					rows.Close()
					return false, scanErr
				}
				if "" == strings.TrimSpace(blockID) || "" == strings.TrimSpace(rootID) {
					continue
				}
				if _, excluded := excludeBlockIDSet[blockID]; excluded {
					continue
				}
				if _, excluded := excludeRootIDSet[rootID]; excluded {
					continue
				}
				if closeErr := rows.Close(); closeErr != nil {
					return false, closeErr
				}
				return true, nil
			}
			if rowsErr := rows.Err(); rowsErr != nil {
				rows.Close()
				return false, rowsErr
			}
			if closeErr := rows.Close(); closeErr != nil {
				return false, closeErr
			}
		}
		return false, nil
	}

	if ret, err = exist("def_block_id", defIDs); err != nil || ret {
		return
	}
	ret, err = exist("def_block_root_id", defRootIDs)
	return
}

// ExistRefByDefIDs 检查全局库及所有已打开加密库中来自删除集合外部的引用。
func ExistRefByDefIDs(defIDs, defRootIDs, excludeBlockIDs, excludeRootIDs []string) (ret bool, err error) {
	if ret, err = ExistRefByDefIDsInBox(defIDs, defRootIDs, excludeBlockIDs, excludeRootIDs, ""); err != nil || ret {
		return
	}
	for _, boxID := range GetEncryptedBoxIDs() {
		if ret, err = ExistRefByDefIDsInBox(defIDs, defRootIDs, excludeBlockIDs, excludeRootIDs, boxID); err != nil || ret {
			return
		}
	}
	return
}

// QueryBoundBlockAVIDsInBox 查询删除集合中绑定块所属的属性视图。
func QueryBoundBlockAVIDsInBox(blockIDs, rootIDs []string, boxID string) (ret map[string][]string, err error) {
	const batchSize = 900

	blockIDs = filterNonEmptyRefCheckIDs(blockIDs)
	rootIDs = filterNonEmptyRefCheckIDs(rootIDs)
	ret = map[string][]string{}
	queryByColumn := func(column string, ids []string) error {
		for start := 0; start < len(ids); start += batchSize {
			end := start + batchSize
			if len(ids) < end {
				end = len(ids)
			}
			batch := ids[start:end]
			placeholders := strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")
			args := make([]any, 0, len(batch))
			for _, id := range batch {
				args = append(args, id)
			}
			rows, queryErr := queryForBox(boxID, "SELECT id, ial FROM blocks WHERE "+column+" IN ("+placeholders+") AND instr(ial, 'custom-avs=') > 0", args...)
			if nil != queryErr {
				return queryErr
			}
			for rows.Next() {
				var blockID, ialContent string
				if scanErr := rows.Scan(&blockID, &ialContent); nil != scanErr {
					rows.Close()
					return scanErr
				}
				if "" == strings.TrimSpace(blockID) {
					continue
				}
				ialContent = strings.TrimPrefix(ialContent, "{:")
				ialContent = strings.TrimSuffix(ialContent, "}")
				for _, kv := range parse.Tokens2IAL([]byte(ialContent)) {
					if 2 > len(kv) || "custom-avs" != kv[0] {
						continue
					}
					for avID := range strings.SplitSeq(kv[1], ",") {
						avID = strings.TrimSpace(avID)
						if "" != avID && !gulu.Str.Contains(avID, ret[blockID]) {
							ret[blockID] = append(ret[blockID], avID)
						}
					}
				}
			}
			if rowsErr := rows.Err(); nil != rowsErr {
				rows.Close()
				return rowsErr
			}
			if closeErr := rows.Close(); nil != closeErr {
				return closeErr
			}
		}
		return nil
	}

	if err = queryByColumn("id", blockIDs); nil != err {
		return
	}
	err = queryByColumn("root_id", rootIDs)
	return
}

func filterNonEmptyRefCheckIDs(ids []string) (ret []string) {
	seen := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if "" == id {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ret = append(ret, id)
	}
	return
}

// QueryBoundBlockAVIDs 查询全局库及所有已打开加密库中删除集合内的数据库绑定块。
func QueryBoundBlockAVIDs(blockIDs, rootIDs []string) (ret map[string][]string, err error) {
	ret = map[string][]string{}
	merge := func(boxID string) error {
		boxRet, queryErr := QueryBoundBlockAVIDsInBox(blockIDs, rootIDs, boxID)
		if nil != queryErr {
			return queryErr
		}
		for blockID, avIDs := range boxRet {
			for _, avID := range avIDs {
				if !gulu.Str.Contains(avID, ret[blockID]) {
					ret[blockID] = append(ret[blockID], avID)
				}
			}
		}
		return nil
	}
	if err = merge(""); nil != err {
		return
	}
	for _, boxID := range GetEncryptedBoxIDs() {
		if err = merge(boxID); nil != err {
			return
		}
	}
	return
}

func QueryRootChildrenRefCount(defRootID string) (ret map[string]int) {
	ret = map[string]int{}
	rows, err := query("SELECT def_block_id, COUNT(*) AS ref_cnt FROM refs WHERE def_block_root_id = ? GROUP BY def_block_id", defRootID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

func QueryRootBlockRefCount() (ret map[string]int) {
	ret = map[string]int{}
	if nil == db {
		return
	}

	// 全局 refs
	rows, err := query("SELECT def_block_root_id, COUNT(DISTINCT block_id) AS ref_cnt FROM refs GROUP BY def_block_root_id")
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}

	// 加密笔记本的 refs
	for _, encBoxID := range GetEncryptedBoxIDs() {
		encRows, encErr := queryForBox(encBoxID, "SELECT def_block_root_id, COUNT(DISTINCT block_id) AS ref_cnt FROM refs GROUP BY def_block_root_id")
		if encErr != nil {
			continue
		}
		for encRows.Next() {
			var id string
			var cnt int
			if err = encRows.Scan(&id, &cnt); err != nil {
				continue
			}
			ret[id] += cnt
		}
		encRows.Close()
	}
	return
}

func QueryDefRootBlocksByRefRootID(refRootID string) (ret []*Block) {
	rows, err := query("SELECT * FROM blocks WHERE id IN (SELECT DISTINCT def_block_root_id FROM refs WHERE root_id = ?)", refRootID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if block := scanBlockRows(rows); nil != block {
			ret = append(ret, block)
		}
	}
	return
}

func QueryRefRootBlocksByDefRootIDs(defRootIDs []string) (ret map[string][]*Block) {
	ret = map[string][]*Block{}

	stmt := "SELECT r.def_block_root_id, b.* FROM refs AS r, blocks AS b ON r.def_block_root_id IN ('" + strings.Join(defRootIDs, "','") + "')" + " AND b.id = r.root_id"
	rows, err := query(stmt)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block Block
		var defRootID string
		if err := rows.Scan(&defRootID, &block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); err != nil {
			logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
			return
		}

		if nil == ret[defRootID] {
			ret[defRootID] = []*Block{&block}
		} else {
			ret[defRootID] = append(ret[defRootID], &block)
		}
	}
	return
}

func GetRefText(defBlockID string) (ret string) {
	ret = getRefText(defBlockID)
	ret = strings.ReplaceAll(ret, search.SearchMarkLeft, "")
	ret = strings.ReplaceAll(ret, search.SearchMarkRight, "")
	return
}

func getRefText(defBlockID string) string {
	block := GetBlock(defBlockID)
	if nil == block {
		if strings.HasPrefix(defBlockID, "assets") {
			return defBlockID
		}
		return "block not found"
	}

	if "" != block.Name {
		return block.Name
	}

	switch block.Type {
	case "d":
		return block.Content
	case "query_embed":
		return "Query Embed Block " + block.Markdown
	case "av":
		return "Database " + block.Markdown
	case "iframe":
		return "IFrame " + block.Markdown
	case "tb":
		return "Thematic Break"
	case "video":
		return "Video " + block.Markdown
	case "audio":
		return "Audio " + block.Markdown
	}

	if block.IsContainerBlock() {
		subTree := parse.Parse("", []byte(block.Markdown), luteEngine.ParseOptions)
		return GetContainerText(subTree.Root)
	}
	return block.Content
}

func QueryBlockDefIDsByRefText(refText string) (ret []string) {
	ret = queryDefIDsByDefText(refText)
	ret = append(ret, queryDefIDsByNameAliasAndDocTitle(refText)...)
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func QueryBlockDefIDsByRefTextInBox(refText, boxID string) (ret []string) {
	var q, arg string
	if caseSensitive {
		q = "SELECT DISTINCT(def_block_id) FROM refs WHERE content = ?"
		arg = refText
	} else {
		q = "SELECT DISTINCT(def_block_id) FROM refs WHERE content LIKE ? ESCAPE '\\'"
		arg = escapeLikePattern(refText)
	}
	rows, err := queryForBox(boxID, q, arg)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}

	escaped := escapeLikePattern(refText)
	aliasArg := "%," + escaped + ",%"
	var nameCond, docCond, exactArg string
	if caseSensitive {
		nameCond = "name = ?"
		docCond = "content = ?"
		exactArg = refText
	} else {
		nameCond = "name LIKE ? ESCAPE '\\'"
		docCond = "content LIKE ? ESCAPE '\\'"
		exactArg = escaped
	}
	q = "SELECT id FROM blocks WHERE " + nameCond + " OR (',' || alias || ',') LIKE ? ESCAPE '\\'" +
		" UNION ALL SELECT id FROM (SELECT id FROM blocks WHERE type = 'd' AND " + docCond + " LIMIT ?)"
	rows, err = queryForBox(boxID, q, exactArg, aliasArg, exactArg, 32)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func queryDefIDsByDefText(keyword string) (ret []string) {
	ret = []string{}
	var q, arg string
	if caseSensitive {
		q = "SELECT DISTINCT(def_block_id) FROM refs WHERE content = ?"
		arg = keyword
	} else {
		q = "SELECT DISTINCT(def_block_id) FROM refs WHERE content LIKE ? ESCAPE '\\'"
		arg = escapeLikePattern(keyword)
	}
	rows, err := query(q, arg)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func queryDefIDsByNameAliasAndDocTitle(keyword string) (ret []string) {
	ret = []string{}
	escaped := escapeLikePattern(keyword)
	aliasArg := "%," + escaped + ",%"
	var nameCond, docCond, exactArg string
	if caseSensitive {
		nameCond = "name = ?"
		docCond = "content = ?"
		exactArg = keyword
	} else {
		nameCond = "name LIKE ? ESCAPE '\\'"
		docCond = "content LIKE ? ESCAPE '\\'"
		exactArg = escaped
	}
	// 命名精确匹配；别名按逗号整段匹配（','||alias||',' LIKE '%,kw,%'）；文档标题单独 LIMIT 32
	// 大小写均跟随 caseSensitive / case_sensitive_like 配置；LIKE 参数转义 %/_/\ 以免通配符改变语义
	q := "SELECT id FROM blocks WHERE " + nameCond + " OR (',' || alias || ',') LIKE ? ESCAPE '\\'" +
		" UNION ALL SELECT id FROM (" +
		"SELECT id FROM blocks WHERE type = 'd' AND " + docCond + " LIMIT ?" +
		")"
	rows, err := query(q, exactArg, aliasArg, exactArg, 32)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func QueryChildRefDefIDsByRootDefID(rootDefID string) (ret map[string][]string) {
	ret = map[string][]string{}
	rows, err := query("SELECT block_id, def_block_id FROM refs WHERE def_block_root_id =  ?", rootDefID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var defID, refID string
		if err = rows.Scan(&defID, &refID); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		if nil == ret[defID] {
			ret[defID] = []string{refID}
		} else {
			ret[defID] = append(ret[defID], refID)
		}
	}
	return
}

func QueryChildDefIDsByRootDefID(rootDefID string) (ret []string) {
	ret = []string{}
	rows, err := query("SELECT DISTINCT(def_block_id) FROM refs WHERE def_block_root_id = ?", rootDefID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func QueryRefIDsByDefID(defID string, containChildren bool) (refIDs []string) {
	refIDs = []string{}
	var rows *sql.Rows
	var err error
	if containChildren {
		rows, err = query("SELECT DISTINCT block_id FROM refs WHERE def_block_root_id = ?", defID)
	} else {
		rows, err = query("SELECT DISTINCT block_id FROM refs WHERE def_block_id = ?", defID)
	}
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refIDs = append(refIDs, id)
	}
	return
}

func QueryRefsRecent(onlyDoc bool, typeFilter string, ignoreLines []string) (ret []*Ref) {
	stmt := "SELECT r.* FROM refs AS r, blocks AS b WHERE b.id = r.def_block_id AND b.type IN " + typeFilter
	if onlyDoc {
		stmt = "SELECT r.* FROM refs AS r, blocks AS b WHERE b.id = r.def_block_id AND b.type = 'd'"
	}
	if 0 < len(ignoreLines) {
		// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089
		buf := bytes.Buffer{}
		for _, line := range ignoreLines {
			buf.WriteString(" AND ")
			buf.WriteString(line)
		}
		stmt += buf.String()
	}
	stmt += " GROUP BY r.def_block_id ORDER BY r.id DESC LIMIT 32"
	rows, err := query(stmt)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		ref := scanRefRows(rows)
		ret = append(ret, ref)
	}
	return
}

func QueryRefsByDefID(defBlockID string, containChildren bool) (ret []*Ref) {
	var rows *sql.Rows
	var err error
	if containChildren {
		rows, err = query(queryRefsByDefIDWithChildren, defBlockID)
	} else {
		rows, err = query("SELECT * FROM refs WHERE def_block_id = ?", defBlockID)
	}
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		ref := scanRefRows(rows)
		ret = append(ret, ref)
	}
	return
}

const queryRefsByDefIDWithChildren = `WITH RECURSIVE child_ids(id) AS (
	SELECT ?
	UNION
	SELECT blocks.id FROM blocks JOIN child_ids ON blocks.parent_id = child_ids.id
)
SELECT refs.* FROM refs JOIN child_ids ON refs.def_block_id = child_ids.id`

func QueryRefsByDefIDRefID(defBlockID, refBlockID string) (ret []*Ref) {
	stmt := "SELECT * FROM refs WHERE def_block_id = ? AND block_id = ?"
	rows, err := query(stmt, defBlockID, refBlockID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		ref := scanRefRows(rows)
		ret = append(ret, ref)
	}
	return
}

func DefRefs(condition string, limit int) (ret []map[*Block]*Block) {
	ret = []map[*Block]*Block{}
	stmt := "SELECT ref.*, r.block_id || '@' || r.def_block_id AS rel FROM blocks AS ref, refs AS r WHERE ref.id = r.block_id"
	if "" != condition {
		stmt += " AND " + condition
	}

	rows, err := query(stmt)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	refs := map[string]*Block{}
	for rows.Next() {
		var ref Block
		var rel string
		if err = rows.Scan(&ref.ID, &ref.ParentID, &ref.RootID, &ref.Hash, &ref.Box, &ref.Path, &ref.HPath, &ref.Name, &ref.Alias, &ref.Memo, &ref.Tag, &ref.Content, &ref.FContent, &ref.Markdown, &ref.Length, &ref.Type, &ref.SubType, &ref.IAL, &ref.Sort, &ref.Created, &ref.Updated,
			&rel); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refs[rel] = &ref
	}

	rows, err = query("SELECT def.* FROM blocks AS def, refs AS r WHERE def.id = r.def_block_id LIMIT ?", limit)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	defs := map[string]*Block{}
	for rows.Next() {
		if def := scanBlockRows(rows); nil != def {
			defs[def.ID] = def
		}
	}

	for rel, ref := range refs {
		defID := strings.Split(rel, "@")[1]
		def := defs[defID]
		if nil == def {
			continue
		}
		defRef := map[*Block]*Block{}
		defRef[def] = ref
		ret = append(ret, defRef)
	}
	return
}

func scanRefRows(rows *sql.Rows) (ret *Ref) {
	var ref Ref
	if err := rows.Scan(&ref.ID, &ref.DefBlockID, &ref.DefBlockParentID, &ref.DefBlockRootID, &ref.DefBlockPath, &ref.BlockID, &ref.RootID, &ref.Box, &ref.Path, &ref.Content, &ref.Markdown, &ref.Type); err != nil {
		logging.LogErrorf("query scan field failed: %s", err)
		return
	}
	ret = &ref
	return
}
