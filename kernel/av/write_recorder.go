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
	active func() bool
	record SourceWriteRecorder
}

// RecordSourceWrites covers all parsed copies used by one serialized editing
// transaction, including two-way relation helpers that reload the same database.
func RecordSourceWrites(view *AttributeView, active func() bool, record SourceWriteRecorder) func() {
	_, box := FindAttributeViewPath(view.ID)
	key := box + "/" + view.ID
	sourceWriteRecorders.Store(key, &sourceWriteRecord{active, record})
	return func() { sourceWriteRecorders.Delete(key) }
}
