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

package treenode

import (
	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

func ClearRedundantBlockTrees(boxID string, paths []string) {
	redundantPaths := getRedundantPaths(boxID, paths)
	for _, p := range redundantPaths {
		removeBlockTreesByPath(boxID, p)
	}
}

func getRedundantPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	btPathsMap := map[string]bool{}
	sqlStmt := "SELECT path FROM blocktrees WHERE box_id = ?"
	rows, err := db.Query(sqlStmt, boxID)
	if nil != err {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); nil != err {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		btPathsMap[path] = true
	}

	for p, _ := range btPathsMap {
		if !pathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func removeBlockTreesByPath(boxID, path string) {
	sqlStmt := "DELETE FROM blocktrees WHERE box_id = ? AND path = ?"
	_, err := db.Exec(sqlStmt, boxID, path)
	if nil != err {
		logging.LogErrorf("delete block tree failed: %s", err)
	}
}

func GetNotExistPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	btPathsMap := map[string]bool{}
	sqlStmt := "SELECT path FROM blocktrees WHERE box_id = ?"
	rows, err := db.Query(sqlStmt, boxID)
	if nil != err {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); nil != err {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		btPathsMap[path] = true
	}

	for p, _ := range pathsMap {
		if !btPathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetRootUpdated() (ret map[string]string) {
	ret = map[string]string{}
	sqlStmt := "SELECT root_id, updated FROM blocktrees WHERE root_id = id AND type = 'd'"
	rows, err := db.Query(sqlStmt)
	if nil != err {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rootID, updated string
		if err = rows.Scan(&rootID, &updated); nil != err {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		ret[rootID] = updated
	}
	return
}
