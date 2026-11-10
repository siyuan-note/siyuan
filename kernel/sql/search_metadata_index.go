// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import "database/sql"

// 字段拼接匹配需要补查元数据非空的块，部分索引使普通正文块不参与这一步扫描。
const BlockSearchMetadataPredicate = "(name != '' OR alias != '' OR memo != '' OR tag != '')"

func ensureSearchMetadataIndex(database *sql.DB) error {
	_, err := database.Exec("CREATE INDEX IF NOT EXISTS idx_blocks_search_metadata_root_id ON blocks(root_id) WHERE " + BlockSearchMetadataPredicate)
	return err
}
