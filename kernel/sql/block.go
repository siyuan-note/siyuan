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

	"github.com/siyuan-note/siyuan/kernel/cache"
)

type Block struct {
	ID       string
	ParentID string
	RootID   string
	Hash     string
	Box      string
	Path     string
	HPath    string
	Name     string
	Alias    string
	Memo     string
	Tag      string
	Content  string
	FContent string
	Markdown string
	Length   int
	Type     string
	SubType  string
	IAL      string
	Sort     int
	Created  string
	Updated  string
}

func updateRootContent(tx *sql.Tx, content, updated, id string) (err error) {
	stmt := "UPDATE blocks SET content = ?, fcontent = ?, updated = ? WHERE id = ?"
	if err = execStmtTx(tx, stmt, content, content, updated, id); nil != err {
		return
	}
	stmt = "UPDATE blocks_fts SET content = ?, fcontent = ?, updated = ? WHERE id = ?"
	if err = execStmtTx(tx, stmt, content, content, updated, id); nil != err {
		return
	}
	if !caseSensitive {
		stmt = "UPDATE blocks_fts_case_insensitive SET content = ?, fcontent = ?, updated = ? WHERE id = ?"
		if err = execStmtTx(tx, stmt, content, content, updated, id); nil != err {
			return
		}
	}
	removeBlockCache(id)
	cache.RemoveBlockIAL(id)
	return
}

func updateBlockContent(tx *sql.Tx, block *Block) (err error) {
	stmt := "UPDATE blocks SET content = ? WHERE id = ?"
	if err = execStmtTx(tx, stmt, block.Content, block.ID); nil != err {
		tx.Rollback()
		return
	}
	stmt = "UPDATE blocks_fts SET content = ? WHERE id = ?"
	if err = execStmtTx(tx, stmt, block.Content, block.ID); nil != err {
		tx.Rollback()
		return
	}
	if !caseSensitive {
		stmt = "UPDATE blocks_fts_case_insensitive SET content = ? WHERE id = ?"
		if err = execStmtTx(tx, stmt, block.Content, block.ID); nil != err {
			tx.Rollback()
			return
		}
	}

	putBlockCache(block)
	return
}
