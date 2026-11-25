// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"encoding/json"
	"strings"
)

func QueryOCRAssetDocuments(paths map[string]bool, refreshAll bool) ([]Asset, error) {
	stmt := "SELECT DISTINCT root_id, box FROM assets"
	var args []any
	if !refreshAll {
		basePaths := make([]string, 0, len(paths))
		for path := range paths {
			basePaths = append(basePaths, strings.SplitN(path, "?", 2)[0])
		}
		encoded, err := json.Marshal(basePaths)
		if err != nil {
			return nil, err
		}
		// 资源索引不保存图片链接的查询参数，文档扫描按完整的 OCR 资源身份匹配。
		stmt += " WHERE substr(path, 1, min(instr(path || '?', '?'), instr(path || '#', '#')) - 1) IN (SELECT value FROM json_each(?))"
		args = append(args, string(encoded))
	}
	rows, err := query(stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Asset
	for rows.Next() {
		var asset Asset
		if err = rows.Scan(&asset.RootID, &asset.Box); err != nil {
			return nil, err
		}
		result = append(result, asset)
	}
	return result, rows.Err()
}
