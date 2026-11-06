// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func buildDocumentSearchCandidates(keywords []string, typeFilter string, searchHPath bool) string {
	keyword := ""
	for _, candidate := range keywords {
		// 逗号可能来自 GROUP_CONCAT 的块间分隔符，空字符也不适合作为 FTS 短语。
		if strings.ContainsAny(candidate, ",\x00") || utf8.RuneCountInString(candidate) <= utf8.RuneCountInString(keyword) {
			continue
		}
		keyword = candidate
	}
	if keyword == "" {
		return ""
	}
	// 最长关键词减少候选量，其他关键词仍由原有文档聚合条件逐一验证。
	ftsQuery := columnFilter() + ":(" + stringQuery(strings.ReplaceAll(keyword, "''", "'")) + ")"
	ret := "SELECT root_id FROM blocks_fts WHERE blocks_fts MATCH '" + strings.ReplaceAll(ftsQuery, "'", "''") + "'"
	if utf8.RuneCountInString(keyword) > 1 {
		metadataFilter := sql.BlockSearchMetadataPredicate
		if Conf.LoadSearch().IAL {
			// IAL 通常包含每个块的 ID 和更新时间，只在用户开启属性检索时补查。
			metadataFilter = "(" + metadataFilter + " OR ial != '')"
		}
		// 多个字段直接拼接时，关键词可能跨越字段边界，FTS 的单列短语不能覆盖这类结果。
		ret += " UNION SELECT root_id FROM blocks WHERE " + metadataFilter + " AND " + typeFilter + " AND (" +
			columnConcat() + ") LIKE " + documentKeywordLikePattern(keyword)
	}
	if searchHPath {
		settings := Conf.LoadSearch()
		normalized := search.NormalizeSearchText(keyword, settings.CaseSensitive, settings.HanSensitiveVal())
		ret += " UNION SELECT root_id FROM blocks WHERE type = 'd' AND instr(" +
			normalizedHPathSearchField("hpath") + ", '" + normalized + "') > 0"
	}
	return ret
}
