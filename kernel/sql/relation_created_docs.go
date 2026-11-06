// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import "errors"

// HasDocumentRefsOutsideRootsInBox 为新建后失败的保守清理保留任何外部引用；查询错误不能当作无引用。
func HasDocumentRefsOutsideRootsInBox(rootID string, owned map[string]bool, boxID string) (bool, error) {
	initDatabaseLock.Lock()
	defer initDatabaseLock.Unlock()
	dbQueueLock.Lock()
	pending := len(operationQueue) > 0
	dbQueueLock.Unlock()
	if pending {
		return false, errors.New("document reference index has pending writes")
	}
	rows, err := queryForBox(boxID, "SELECT DISTINCT root_id FROM refs WHERE def_block_root_id = ?", rootID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var refRootID string
		if err = rows.Scan(&refRootID); err != nil {
			return false, err
		}
		if !owned[refRootID] {
			return true, nil
		}
	}
	return false, rows.Err()
}
