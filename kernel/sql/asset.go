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
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Asset struct {
	ID      string
	BlockID string
	RootID  string
	Box     string
	DocPath string
	Path    string
	Name    string
	Title   string
	Hash    string
}

func docTagSpans(n *ast.Node) (ret []*Span) {
	if tagsVal := n.IALAttr("tags"); "" != tagsVal {
		tags := strings.Split(tagsVal, ",")
		for _, tag := range tags {
			markdown := "#" + tag + "#"
			span := &Span{
				ID:       ast.NewNodeID(),
				BlockID:  n.ID,
				RootID:   n.ID,
				Box:      n.Box,
				Path:     n.Path,
				Content:  tag,
				Markdown: markdown,
				Type:     "tag",
				IAL:      "",
			}
			ret = append(ret, span)
		}
	}
	return
}

func docTitleImgAsset(root *ast.Node) *Asset {
	if p := treenode.GetDocTitleImgPath(root); "" != p {
		if !util.IsAssetLinkDest([]byte(p)) {
			return nil
		}

		var hash string
		var err error
		absPath := filepath.Join(util.DataDir, p)
		if hash, err = util.GetEtag(absPath); nil != err {
			logging.LogErrorf("read asset [%s] data failed: %s", absPath, err)
			return nil
		}
		name, _ := util.LastID(p)
		asset := &Asset{
			ID:      ast.NewNodeID(),
			BlockID: root.ID,
			RootID:  root.ID,
			Box:     root.Box,
			DocPath: p,
			Path:    p,
			Name:    name,
			Title:   "title-img",
			Hash:    hash,
		}
		return asset
	}
	return nil
}

func deleteAssetsByHashes(tx *sql.Tx, hashes []string) (err error) {
	sqlStmt := "DELETE FROM assets WHERE hash IN ('" + strings.Join(hashes, "','") + "') OR hash = ''"
	err = execStmtTx(tx, sqlStmt)
	return
}

func QueryAssetByHash(hash string) (ret *Asset) {
	sqlStmt := "SELECT * FROM assets WHERE hash = ?"
	row := queryRow(sqlStmt, hash)
	var asset Asset
	if err := row.Scan(&asset.ID, &asset.BlockID, &asset.RootID, &asset.Box, &asset.DocPath, &asset.Path, &asset.Name, &asset.Title, &asset.Hash); nil != err {
		if sql.ErrNoRows != err {
			logging.LogErrorf("query scan field failed: %s", err)
		}
		return
	}
	ret = &asset
	return
}

func QueryRootBlockAssets(rootID string) (ret []*Asset) {
	sqlStmt := "SELECT * FROM assets WHERE root_id = ?"
	rows, err := query(sqlStmt, rootID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		asset := scanAssetRows(rows)
		ret = append(ret, asset)
	}
	return
}

func scanAssetRows(rows *sql.Rows) (ret *Asset) {
	var asset Asset
	if err := rows.Scan(&asset.ID, &asset.BlockID, &asset.RootID, &asset.Box, &asset.DocPath, &asset.Path, &asset.Name, &asset.Title, &asset.Hash); nil != err {
		logging.LogErrorf("query scan field failed: %s", err)
		return
	}
	ret = &asset
	return
}

func assetLocalPath(linkDest, boxLocalPath, docDirLocalPath string) (ret string) {
	ret = filepath.Join(docDirLocalPath, linkDest)
	if gulu.File.IsExist(ret) {
		return
	}

	ret = filepath.Join(boxLocalPath, linkDest)
	if gulu.File.IsExist(ret) {
		return
	}

	ret = filepath.Join(util.DataDir, linkDest)
	if gulu.File.IsExist(ret) {
		return
	}
	return ""
}
