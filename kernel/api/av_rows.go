package api

import (
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// attributeViewRowMatchesTitle 匹配主键标题，search 由调用方统一去除首尾空白并转为小写。
func attributeViewRowMatchesTitle(row *av.TableRow, search string) bool {
	if search == "" {
		return true
	}
	for _, cell := range row.Cells {
		if cell == nil || cell.Value == nil || cell.Value.Type != av.KeyTypeBlock || cell.Value.Block == nil {
			continue
		}
		return strings.Contains(strings.ToLower(cell.Value.Block.Content), search)
	}
	return false
}

// paginateAttributeViewRows 为已筛选和排序的条目分页，空页保持非 nil 切片。
func paginateAttributeViewRows(rows []*av.TableRow, page, pageSize int) []*av.TableRow {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	} else if pageSize > 100 {
		pageSize = 100
	}
	if page > (len(rows)+pageSize-1)/pageSize {
		return []*av.TableRow{}
	}
	start := (page - 1) * pageSize
	end := min(len(rows), start+pageSize)
	return rows[start:end]
}
