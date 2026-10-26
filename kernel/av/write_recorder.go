package av

import "sync"

type SourceWriteRecorder func(boxID string, before, after []byte) error

var sourceWriteRecorders sync.Map // storage boundary + database ID -> *sourceWriteRecord

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
