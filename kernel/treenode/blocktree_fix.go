// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	rows, err := queryForBox(boxID, sqlStmt, boxID)
	if err != nil {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		btPathsMap[path] = true
	}

	for p := range btPathsMap {
		if !pathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func removeBlockTreesByPath(boxID, path string) {
	sqlStmt := "DELETE FROM blocktrees WHERE box_id = ? AND path = ?"
	_, err := execForBox(boxID, sqlStmt, boxID, path)
	if err != nil {
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
	rows, err := queryForBox(boxID, sqlStmt, boxID)
	if err != nil {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		btPathsMap[path] = true
	}

	for p := range pathsMap {
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
	if err != nil {
		logging.LogErrorf("query block tree failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rootID, updated string
		if err = rows.Scan(&rootID, &updated); err != nil {
			logging.LogErrorf("scan block tree failed: %s", err)
			return
		}
		ret[rootID] = updated
	}
	if err = rows.Err(); err != nil {
		logging.LogErrorf("iterate block tree failed: %s", err)
	}
	return
}
