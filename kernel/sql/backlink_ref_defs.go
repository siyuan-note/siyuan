package sql

import "strings"

// QueryBacklinkRefDefsInBox 批量读取条目内容块的引用关系，保留数据库隔离边界。
func QueryBacklinkRefDefsInBox(blockIDs []string, boxID string) (ret map[string][]string, err error) {
	ret = map[string][]string{}
	for start := 0; start < len(blockIDs); start += queryRefsByDefIDsBatchSize {
		batch := blockIDs[start:min(start+queryRefsByDefIDsBatchSize, len(blockIDs))]
		args := make([]any, len(batch))
		for i, id := range batch {
			args[i] = id
		}
		rows, queryErr := queryForBox(boxID, "SELECT DISTINCT block_id, def_block_id FROM refs WHERE block_id IN ("+
			strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")+")", args...)
		if nil != queryErr {
			return nil, queryErr
		}
		for rows.Next() {
			var blockID, defID string
			if err = rows.Scan(&blockID, &defID); nil != err {
				rows.Close()
				return nil, err
			}
			ret[blockID] = append(ret[blockID], defID)
		}
		err = rows.Err()
		rows.Close()
		if nil != err {
			return nil, err
		}
	}
	return
}
