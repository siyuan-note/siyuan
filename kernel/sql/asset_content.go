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
	"fmt"
	"strings"

	"github.com/siyuan-note/eventbus"
)

type AssetContent struct {
	ID      string
	Name    string
	Ext     string
	Path    string
	Size    int64
	Updated int64
	Content string
}

const (
	AssetContentsFTSCaseInsensitiveInsert = "INSERT INTO asset_contents_fts_case_insensitive (id, name, ext, path, size, updated, content) VALUES %s"
	AssetContentsPlaceholder              = "(?, ?, ?, ?, ?, ?, ?)"
)

func insertAssetContents(tx *sql.Tx, assetContents []*AssetContent, context map[string]interface{}) (err error) {
	if 1 > len(assetContents) {
		return
	}

	var bulk []*AssetContent
	for _, assetContent := range assetContents {
		bulk = append(bulk, assetContent)
		if 512 > len(bulk) {
			continue
		}

		if err = insertAssetContents0(tx, bulk, context); nil != err {
			return
		}
		bulk = []*AssetContent{}
	}
	if 0 < len(bulk) {
		if err = insertAssetContents0(tx, bulk, context); nil != err {
			return
		}
	}
	return
}

func insertAssetContents0(tx *sql.Tx, bulk []*AssetContent, context map[string]interface{}) (err error) {
	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(AssetContentsPlaceholder, "?"))
	for _, b := range bulk {
		valueStrings = append(valueStrings, AssetContentsPlaceholder)
		valueArgs = append(valueArgs, b.ID)
		valueArgs = append(valueArgs, b.Name)
		valueArgs = append(valueArgs, b.Ext)
		valueArgs = append(valueArgs, b.Path)
		valueArgs = append(valueArgs, b.Size)
		valueArgs = append(valueArgs, b.Updated)
		valueArgs = append(valueArgs, b.Content)
	}

	stmt := fmt.Sprintf(AssetContentsFTSCaseInsensitiveInsert, strings.Join(valueStrings, ","))
	if err = prepareExecInsertTx(tx, stmt, valueArgs); nil != err {
		return
	}

	eventbus.Publish(eventbus.EvtSQLInsertAssetContent, context)
	return
}

func deleteAssetContentsByPath(tx *sql.Tx, path string, context map[string]interface{}) (err error) {
	stmt := "DELETE FROM asset_contents_fts_case_insensitive WHERE path = ?"
	if err = execStmtTx(tx, stmt, path); nil != err {
		return
	}
	return
}
