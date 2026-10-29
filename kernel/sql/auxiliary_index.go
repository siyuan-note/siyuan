// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"fmt"
	"strings"
)

// auxiliaryIndexKey 只比较业务字段，派生记录 ID 不参与相等性判断；NULL 与空字符串仍有区别。
type auxiliaryIndexKey struct {
	fields [11]string
	nulls  uint16
}

func auxiliaryKey(fields ...string) (key auxiliaryIndexKey) {
	copy(key.fields[:], fields)
	return
}

type auxiliaryIndexTable struct {
	name, columns string // columns 的首列必须是记录所属块的 block_id。
	byPath        bool
}

var (
	spanIndex           = auxiliaryIndexTable{"spans", "block_id,root_id,box,path,content,markdown,type,ial", false}
	assetIndex          = auxiliaryIndexTable{"assets", "block_id,root_id,box,docpath,path,name,title,hash", false}
	attributeIndex      = auxiliaryIndexTable{"attributes", "block_id,root_id,box,path,name,value,type", false}
	refIndex            = auxiliaryIndexTable{"refs", "block_id,root_id,box,path,def_block_id,def_block_parent_id,def_block_root_id,def_block_path,content,markdown,type", true}
	fileAnnotationIndex = auxiliaryIndexTable{"file_annotation_refs", "block_id,root_id,box,path,file_path,annotation_id,content,type", true}
)

type auxiliaryIndexChange[T any] struct {
	table  auxiliaryIndexTable
	remove []int64
	insert []*T
}

// diffAuxiliaryIndex 在写入事务内比较完整快照，逐块保留相等的记录多重集。
func diffAuxiliaryIndex[T any](tx *sql.Tx, table auxiliaryIndexTable, rootID, box, path string,
	next []*T, keyOf func(*T) auxiliaryIndexKey) (change auxiliaryIndexChange[T], err error) {
	change.table = table
	remaining := make(map[auxiliaryIndexKey]int, len(next))
	for _, value := range next {
		remaining[keyOf(value)]++
	}
	condition, args := "root_id = ?", []any{rootID}
	if table.byPath {
		condition, args = "box = ? AND path = ?", []any{box, path}
	}
	rows, err := tx.Query("SELECT rowid,"+table.columns+" FROM "+table.name+" WHERE "+condition, args...)
	if err != nil {
		return change, fmt.Errorf("read %s index: %w", table.name, err)
	}
	defer rows.Close()
	type existingRow struct {
		rowID int64
		block string
	}
	var existing []existingRow
	changedBlocks := map[string]bool{}
	var rowID int64
	fields := make([]sql.NullString, strings.Count(table.columns, ",")+1)
	scan := make([]any, len(fields)+1)
	scan[0] = &rowID
	for i := range fields {
		scan[i+1] = &fields[i]
	}
	for rows.Next() {
		if err = rows.Scan(scan...); err != nil {
			return change, err
		}
		var key auxiliaryIndexKey
		for i, field := range fields {
			key.fields[i] = field.String
			if !field.Valid {
				key.nulls |= 1 << i
			}
		}
		existing = append(existing, existingRow{rowID, key.fields[0]})
		if remaining[key] > 0 {
			remaining[key]--
		} else {
			changedBlocks[key.fields[0]] = true
		}
	}
	if err = rows.Err(); err != nil {
		return change, err
	}
	if err = rows.Close(); err != nil {
		return change, err
	}
	for key, count := range remaining {
		if count > 0 {
			changedBlocks[key.fields[0]] = true
		}
	}
	for _, row := range existing {
		if changedBlocks[row.block] {
			change.remove = append(change.remove, row.rowID)
		}
	}
	for _, value := range next {
		if changedBlocks[keyOf(value).fields[0]] {
			change.insert = append(change.insert, value)
		}
	}
	return
}

func (change auxiliaryIndexChange[T]) delete(tx *sql.Tx) error {
	const batchSize = 512
	for start := 0; start < len(change.remove); start += batchSize {
		batch := change.remove[start:min(start+batchSize, len(change.remove))]
		args := make([]any, len(batch))
		for i, rowID := range batch {
			args[i] = rowID
		}
		if err := execStmtTx(tx, "DELETE FROM "+change.table.name+" WHERE rowid IN ("+
			strings.Repeat("?,", len(batch)-1)+"?)", args...); err != nil {
			return err
		}
	}
	return nil
}

func spanIndexKey(value *Span) auxiliaryIndexKey {
	return auxiliaryKey(value.BlockID, value.RootID, value.Box, value.Path, value.Content, value.Markdown, value.Type, value.IAL)
}

func assetIndexKey(value *Asset) auxiliaryIndexKey {
	return auxiliaryKey(value.BlockID, value.RootID, value.Box, value.DocPath, value.Path, value.Name, value.Title, value.Hash)
}

func attributeIndexKey(value *Attribute) auxiliaryIndexKey {
	return auxiliaryKey(value.BlockID, value.RootID, value.Box, value.Path, value.Name, value.Value, value.Type)
}

func refIndexKey(value *Ref) auxiliaryIndexKey {
	return auxiliaryKey(value.BlockID, value.RootID, value.Box, value.Path, value.DefBlockID, value.DefBlockParentID,
		value.DefBlockRootID, value.DefBlockPath, value.Content, value.Markdown, value.Type)
}

func fileAnnotationIndexKey(value *FileAnnotationRef) auxiliaryIndexKey {
	return auxiliaryKey(value.BlockID, value.RootID, value.Box, value.Path, value.FilePath, value.AnnotationID, value.Content, value.Type)
}

// ensureAuxiliaryRootIndexes 为既有普通库与加密独立库补齐快照比较所需的根文档索引。
func ensureAuxiliaryRootIndexes(database *sql.DB) error {
	for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex} {
		if _, err := database.Exec("CREATE INDEX IF NOT EXISTS idx_" + table.name + "_root_id ON " + table.name + "(root_id)"); err != nil {
			return err
		}
	}
	return nil
}
