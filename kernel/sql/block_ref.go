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

	"github.com/88250/lute/parse"
)

type Ref struct {
	ID               string
	DefBlockID       string
	DefBlockParentID string
	DefBlockRootID   string
	DefBlockPath     string
	BlockID          string
	RootID           string
	Box              string
	Path             string
	Content          string
	Markdown         string
	Type             string
}

func upsertRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); nil != err {
		return
	}
	err = insertRefs(tx, tree)
	return
}

func deleteRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); nil != err {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); nil != err {
		return
	}
	return
}
