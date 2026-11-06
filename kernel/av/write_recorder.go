// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "sync"

type SourceWriteRecorder func(boxID string, before, after []byte) error

var sourceWriteRecorders sync.Map // storage boundary + database ID -> *sourceWriteRecord

var relationWriteRecorders sync.Map // storage boundary -> SourceWriteRecorder

// RecordRelationWrites includes the dependency index in the same recovery boundary
// as a serialized relation-configuration transaction. Bytes are already encrypted.
func RecordRelationWrites(box string, record SourceWriteRecorder) func() {
	relationWriteRecorders.Store(box, record)
	return func() { relationWriteRecorders.Delete(box) }
}

type sourceWriteRecord struct {
	active   func() bool
	record   SourceWriteRecorder
	recovery bool
}

// RecordSourceWrites covers all parsed copies used by one serialized editing
// transaction, including two-way relation helpers that reload the same database.
func RecordSourceWrites(view *AttributeView, active func() bool, record SourceWriteRecorder) func() {
	return recordSourceWrites(view, active, record, false)
}

// RecordHistorySourceWrites 将历史恢复纳入原始字节事务，恢复前数据容许布局缺失。
func RecordHistorySourceWrites(view *AttributeView, record SourceWriteRecorder) func() {
	return recordSourceWrites(view, func() bool { return true }, record, true)
}

func recordSourceWrites(view *AttributeView, active func() bool, record SourceWriteRecorder, recovery bool) func() {
	_, box := view.StoragePath()
	key := box + "/" + view.ID
	sourceWriteRecorders.Store(key, &sourceWriteRecord{active: active, record: record, recovery: recovery})
	return func() { sourceWriteRecorders.Delete(key) }
}
