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
	"database/sql"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
)

func QueryVirtualRefKeywords(name, alias, anchor, doc bool) (ret []string) {
	if name {
		ret = append(ret, queryNames()...)
	}
	if alias {
		ret = append(ret, queryAliases()...)
	}
	if anchor {
		ret = append(ret, queryRefTexts()...)
	}
	if doc {
		ret = append(ret, queryDocTitles()...)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	sort.SliceStable(ret, func(i, j int) bool {
		return len(ret[i]) >= len(ret[j])
	})
	return
}

func queryRefTexts() (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT DISTINCT content FROM refs LIMIT 10240"
	rows, err := query(sqlStmt)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", sqlStmt, err)
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
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

func QueryRootChildrenRefCount(defRootID string) (ret map[string]int) {
	ret = map[string]int{}
	rows, err := query("SELECT def_block_id, COUNT(*) AS ref_cnt FROM refs WHERE def_block_root_id = ? GROUP BY def_block_id", defRootID)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

func QueryRootBlockRefCount() (ret map[string]int) {
	ret = map[string]int{}

	rows, err := query("SELECT def_block_root_id, COUNT(*) AS ref_cnt FROM refs GROUP BY def_block_root_id")
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

func QueryDefRootBlocksByRefRootID(refRootID string) (ret []*Block) {
	rows, err := query("SELECT * FROM blocks WHERE id IN (SELECT DISTINCT def_block_root_id FROM refs WHERE root_id = ?)", refRootID)
	if nil != err {
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
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block Block
		var defRootID string
		if err := rows.Scan(&defRootID, &block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); nil != err {
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

func QueryBlockDefIDsByRefText(refText string, excludeIDs []string) (ret []string) {
	ret = queryDefIDsByDefText(refText, excludeIDs)
	ret = append(ret, queryDefIDsByNameAlias(refText, excludeIDs)...)
	ret = append(ret, queryDocIDsByTitle(refText, excludeIDs)...)
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func queryDefIDsByDefText(keyword string, excludeIDs []string) (ret []string) {
	ret = []string{}
	notIn := "('" + strings.Join(excludeIDs, "','") + "')"
	q := "SELECT DISTINCT(def_block_id) FROM refs WHERE content LIKE ? AND def_block_id NOT IN " + notIn
	if caseSensitive {
		q = "SELECT DISTINCT(def_block_id) FROM refs WHERE content = ? AND def_block_id NOT IN " + notIn
	}
	rows, err := query(q, keyword)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func queryDefIDsByNameAlias(keyword string, excludeIDs []string) (ret []string) {
	ret = []string{}
	notIn := "('" + strings.Join(excludeIDs, "','") + "')"
	rows, err := query("SELECT DISTINCT(id), name, alias FROM blocks WHERE (name = ? OR alias LIKE ?) AND id NOT IN "+notIn, keyword, "%"+keyword+"%")
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, name, alias string
		if err = rows.Scan(&id, &name, &alias); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		if name == keyword {
			ret = append(ret, id)
			continue
		}

		var hitAlias bool
		aliases := strings.Split(alias, ",")
		for _, a := range aliases {
			if "" == a {
				continue
			}
			if keyword == a {
				hitAlias = true
			}
		}
		if strings.Contains(alias, keyword) && !hitAlias {
			continue
		}
		ret = append(ret, id)
	}
	return
}

func QueryChildDefIDsByRootDefID(rootDefID string) (ret []string) {
	ret = []string{}
	rows, err := query("SELECT DISTINCT(def_block_id) FROM refs WHERE def_block_root_id = ?", rootDefID)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func QueryRefIDsByDefID(defID string, containChildren bool) (refIDs, refTexts []string) {
	refIDs = []string{}
	var rows *sql.Rows
	var err error
	if containChildren {
		rows, err = query("SELECT block_id, content FROM refs WHERE def_block_root_id = ?", defID)
	} else {
		rows, err = query("SELECT block_id, content FROM refs WHERE def_block_id = ?", defID)
	}
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, content string
		if err = rows.Scan(&id, &content); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refIDs = append(refIDs, id)
		refTexts = append(refTexts, content)
	}
	return
}

func QueryRefsRecent(onlyDoc bool) (ret []*Ref) {
	stmt := "SELECT * FROM refs AS r"
	if onlyDoc {
		stmt = "SELECT r.* FROM refs AS r, blocks AS b WHERE b.type = 'd' AND b.id = r.def_block_id"
	}
	stmt += " GROUP BY r.def_block_id ORDER BY r.id DESC LIMIT 32"
	rows, err := query(stmt)
	if nil != err {
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
	sqlBlock := GetBlock(defBlockID)
	if nil == sqlBlock {
		return
	}

	var rows *sql.Rows
	var err error
	if "d" == sqlBlock.Type {
		rows, err = query("SELECT * FROM refs WHERE def_block_root_id = ?", defBlockID)
	} else {
		if containChildren {
			blockIDs := queryBlockChildrenIDs(defBlockID)
			var params []string
			for _, id := range blockIDs {
				params = append(params, "\""+id+"\"")
			}
			rows, err = query("SELECT * FROM refs WHERE def_block_id IN (" + strings.Join(params, ",") + ")")
		} else {
			rows, err = query("SELECT * FROM refs WHERE def_block_id = ?", defBlockID)
		}
	}
	if nil != err {
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

func QueryRefsByDefIDRefID(defBlockID, refBlockID string) (ret []*Ref) {
	stmt := "SELECT * FROM refs WHERE def_block_id = ? AND block_id = ?"
	rows, err := query(stmt, defBlockID, refBlockID)
	if nil != err {
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

func DefRefs(condition string) (ret []map[*Block]*Block) {
	ret = []map[*Block]*Block{}
	stmt := "SELECT ref.*, r.block_id || '@' || r.def_block_id AS rel FROM blocks AS ref, refs AS r WHERE ref.id = r.block_id"
	if "" != condition {
		stmt += " AND " + condition
	}

	rows, err := query(stmt)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	refs := map[string]*Block{}
	for rows.Next() {
		var ref Block
		var rel string
		if err = rows.Scan(&ref.ID, &ref.ParentID, &ref.RootID, &ref.Hash, &ref.Box, &ref.Path, &ref.HPath, &ref.Name, &ref.Alias, &ref.Memo, &ref.Tag, &ref.Content, &ref.FContent, &ref.Markdown, &ref.Length, &ref.Type, &ref.SubType, &ref.IAL, &ref.Sort, &ref.Created, &ref.Updated,
			&rel); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refs[rel] = &ref
	}

	rows, err = query("SELECT def.* FROM blocks AS def, refs AS r WHERE def.id = r.def_block_id")
	if nil != err {
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
	if err := rows.Scan(&ref.ID, &ref.DefBlockID, &ref.DefBlockParentID, &ref.DefBlockRootID, &ref.DefBlockPath, &ref.BlockID, &ref.RootID, &ref.Box, &ref.Path, &ref.Content, &ref.Markdown, &ref.Type); nil != err {
		logging.LogErrorf("query scan field failed: %s", err)
		return
	}
	ret = &ref
	return
}
