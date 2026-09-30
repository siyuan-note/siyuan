package sql

// QueryOCRAssetDocuments 返回普通笔记本中引用资源的文档，用于刷新包含 OCR 文本的块索引。
func QueryOCRAssetDocuments(path string) ([]Asset, error) {
	rows, err := query("SELECT DISTINCT root_id, box FROM assets WHERE path = ? OR instr(path, ?) = 1 OR instr(path, ?) = 1", path, path+"?", path+"#")
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
