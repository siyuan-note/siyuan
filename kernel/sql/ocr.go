package sql

import "strings"

// QueryOCRAssetDocuments 返回普通笔记本中引用资源的文档，用于刷新包含 OCR 文本的块索引。
func QueryOCRAssetDocuments(path string) ([]Asset, error) {
	// 资源索引不保存查询参数，由调用方继续按完整 OCR 资源身份筛选文档中的图片。
	path = strings.SplitN(path, "?", 2)[0]
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
