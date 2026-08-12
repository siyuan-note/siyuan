// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/siyuan-note/filelock"
)

const (
	defaultMaxBatchesPerSegment = 256
	maxSegmentBytes             = 64 * 1024 * 1024
)

var (
	// ErrOperationConflict 表示同一幂等操作 ID 对应了不同内容。
	ErrOperationConflict = errors.New("flashcard operation ID has conflicting content")

	// ErrCorruptSegment 表示权威分段无法通过结构或校验和验证。
	ErrCorruptSegment = errors.New("flashcard journal segment is corrupt")
)

// OperationBatch 是一次用户操作的原子持久化单位。
type OperationBatch struct {
	FormatVersion   int      `json:"formatVersion"`
	BatchID         string   `json:"batchID"`
	OperationID     string   `json:"operationID"`
	OperationDigest string   `json:"operationDigest"`
	DeviceID        string   `json:"deviceID"`
	WriterID        string   `json:"writerID"`
	Sequence        uint64   `json:"sequence"`
	RecordedAt      int64    `json:"recordedAt"`
	Changes         []Change `json:"changes"`
	Checksum        string   `json:"checksum"`
}

// Segment 保存一个写入者的连续操作批次。
type Segment struct {
	FormatVersion int              `json:"formatVersion"`
	SegmentID     string           `json:"segmentID"`
	WriterID      string           `json:"writerID"`
	StartSequence uint64           `json:"startSequence"`
	EndSequence   uint64           `json:"endSequence"`
	Sealed        bool             `json:"sealed"`
	Batches       []OperationBatch `json:"batches"`
	Checksum      string           `json:"checksum"`
}

// JournalOptions 控制日志写入者和测试所需的确定性行为。
type JournalOptions struct {
	WriterID             string
	MaxBatchesPerSegment int
	MaxSegmentBytes      int
	Now                  func() time.Time
}

type operationEntry struct {
	batch  OperationBatch
	digest string
}

// Journal 管理 v2 权威操作分段。
type Journal struct {
	root                 string
	deviceID             string
	writerID             string
	maxBatchesPerSegment int
	maxSegmentBytes      int
	now                  func() time.Time
	nextSequence         uint64
	active               *Segment
	activePath           string
	batches              []OperationBatch
	operations           map[string]operationEntry
	batchChecksums       map[string]string
	writerSequences      map[string]string
	mu                   sync.Mutex
	closed               bool
}

// OpenJournal 打开权威日志并为当前内核运行实例创建写入者。
func OpenJournal(root, deviceID string, options *JournalOptions) (*Journal, error) {
	if strings.TrimSpace(deviceID) == "" {
		return nil, errors.New("device ID is required")
	}
	if err := EnsureManifest(root); err != nil {
		return nil, err
	}
	writerID := ""
	maxBatches := defaultMaxBatchesPerSegment
	segmentBytes := maxSegmentBytes
	now := time.Now
	if options != nil {
		writerID = options.WriterID
		if options.MaxBatchesPerSegment > 0 {
			maxBatches = options.MaxBatchesPerSegment
		}
		if options.MaxSegmentBytes > 0 {
			segmentBytes = options.MaxSegmentBytes
		}
		if options.Now != nil {
			now = options.Now
		}
	}
	if segmentBytes > maxSegmentBytes {
		segmentBytes = maxSegmentBytes
	}
	if writerID == "" {
		writerID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(deviceID+"\x00"+uuid.NewString())).String()
	}
	if _, err := uuid.Parse(writerID); err != nil {
		return nil, fmt.Errorf("invalid writer ID: %w", err)
	}
	journal := &Journal{
		root:                 root,
		deviceID:             deviceID,
		writerID:             writerID,
		maxBatchesPerSegment: maxBatches,
		maxSegmentBytes:      segmentBytes,
		now:                  now,
		operations:           map[string]operationEntry{},
		batchChecksums:       map[string]string{},
		writerSequences:      map[string]string{},
	}
	if err := journal.loadSegments(); err != nil {
		return nil, err
	}
	segmentsDir := journal.segmentsDir()
	if err := os.MkdirAll(segmentsDir, 0755); err != nil {
		return nil, fmt.Errorf("create flashcard writer directory: %w", err)
	}
	return journal, nil
}

// WriterID 返回当前运行实例的唯一写入者 ID。
func (journal *Journal) WriterID() string {
	return journal.writerID
}

func (journal *Journal) abort() {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	journal.closed = true
	journal.active = nil
	journal.activePath = ""
}

// Batches 返回校验通过的全部权威操作批次。
func (journal *Journal) Batches() []OperationBatch {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	ret := make([]OperationBatch, 0, len(journal.batches))
	for _, batch := range journal.batches {
		ret = append(ret, cloneBatch(batch))
	}
	sortBatches(ret)
	return ret
}

// FindOperation 查找已经持久化的幂等操作。
func (journal *Journal) FindOperation(operationID string) (OperationBatch, bool) {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	entry, ok := journal.operations[operationID]
	if !ok {
		return OperationBatch{}, false
	}
	return cloneBatch(entry.batch), true
}

// Reload 重新扫描同步到 v2 目录的分段，并把新批次加入内存索引。
func (journal *Journal) Reload() error {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	if journal.closed {
		return errors.New("flashcard journal is closed")
	}
	if err := journal.loadSegments(); err != nil {
		return err
	}
	return nil
}

// Append 将一个操作批次先写入权威分段。
func (journal *Journal) Append(operationID string, changes []Change) (OperationBatch, bool, error) {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	if journal.closed {
		return OperationBatch{}, false, errors.New("flashcard journal is closed")
	}
	if journal.active != nil && journal.active.Sealed {
		if err := journal.sealActive(); err != nil {
			return OperationBatch{}, false, err
		}
	}
	if strings.TrimSpace(operationID) == "" {
		return OperationBatch{}, false, errors.New("operation ID is required")
	}
	if len(operationID) > 512 {
		return OperationBatch{}, false, errors.New("operation ID is too long")
	}
	normalizedChanges, err := normalizeChanges(changes)
	if err != nil {
		return OperationBatch{}, false, err
	}
	digest, err := checksum(normalizedChanges)
	if err != nil {
		return OperationBatch{}, false, fmt.Errorf("checksum operation changes: %w", err)
	}
	if existing, ok := journal.operations[operationID]; ok {
		if existing.digest != digest {
			return OperationBatch{}, false, ErrOperationConflict
		}
		return cloneBatch(existing.batch), false, nil
	}

	journal.nextSequence++
	batch := OperationBatch{
		FormatVersion:   FormatVersion,
		BatchID:         NewID(),
		OperationID:     operationID,
		OperationDigest: digest,
		DeviceID:        journal.deviceID,
		WriterID:        journal.writerID,
		Sequence:        journal.nextSequence,
		RecordedAt:      journal.now().UnixMilli(),
		Changes:         normalizedChanges,
	}
	if err = sealBatch(&batch); err != nil {
		journal.nextSequence--
		return OperationBatch{}, false, err
	}
	if err = validateBatch(&batch); err != nil {
		journal.nextSequence--
		return OperationBatch{}, false, err
	}
	if journal.active != nil {
		exceeds, sizeErr := journal.activeWouldExceedLimit(batch)
		if sizeErr != nil {
			journal.nextSequence--
			return OperationBatch{}, false, sizeErr
		}
		if exceeds {
			journal.active.Sealed = true
			if err = journal.sealActive(); err != nil {
				journal.nextSequence--
				return OperationBatch{}, false, err
			}
		}
	}
	createdActive := false
	if journal.active == nil {
		journal.active = &Segment{
			FormatVersion: FormatVersion,
			SegmentID:     NewID(),
			WriterID:      journal.writerID,
			StartSequence: batch.Sequence,
		}
		journal.activePath = journal.openSegmentPath(journal.active)
		createdActive = true
	}
	journal.active.Batches = append(journal.active.Batches, batch)
	journal.active.EndSequence = batch.Sequence
	if err = sealSegment(journal.active); err != nil {
		journal.rollbackAppend(createdActive)
		return OperationBatch{}, false, err
	}
	if err = journal.writeSegment(journal.activePath, journal.active); err != nil {
		journal.rollbackAppend(createdActive)
		return OperationBatch{}, false, err
	}
	journal.registerBatch(batch)
	if len(journal.active.Batches) >= journal.maxBatchesPerSegment {
		journal.active.Sealed = true
		if err = sealSegment(journal.active); err != nil {
			return cloneBatch(batch), true, err
		}
		if err = journal.writeSegment(journal.activePath, journal.active); err != nil {
			return cloneBatch(batch), true, err
		}
		if err = journal.sealActive(); err != nil {
			return cloneBatch(batch), true, err
		}
	}
	return cloneBatch(batch), true, nil
}

// Close 封存当前活动分段。
func (journal *Journal) Close() error {
	journal.mu.Lock()
	defer journal.mu.Unlock()
	if journal.closed {
		return nil
	}
	if journal.active == nil {
		journal.closed = true
		return nil
	}
	journal.active.Sealed = true
	if err := sealSegment(journal.active); err != nil {
		return err
	}
	if err := journal.writeSegment(journal.activePath, journal.active); err != nil {
		return err
	}
	if err := journal.sealActive(); err != nil {
		return err
	}
	journal.closed = true
	return nil
}

func (journal *Journal) rollbackAppend(createdActive bool) {
	journal.nextSequence--
	if createdActive {
		journal.active = nil
		journal.activePath = ""
		return
	}
	last := len(journal.active.Batches) - 1
	journal.active.Batches = journal.active.Batches[:last]
	journal.active.EndSequence = journal.active.Batches[last-1].Sequence
	_ = sealSegment(journal.active)
}

func (journal *Journal) sealActive() error {
	if journal.active == nil {
		return nil
	}
	journal.active.Sealed = true
	if err := sealSegment(journal.active); err != nil {
		return err
	}
	if err := journal.writeSegment(journal.activePath, journal.active); err != nil {
		return err
	}
	finalPath := journal.sealedSegmentPath(journal.active)
	if err := os.Rename(journal.activePath, finalPath); err != nil {
		return fmt.Errorf("seal flashcard segment: %w", err)
	}
	journal.active = nil
	journal.activePath = ""
	return nil
}

func (journal *Journal) registerBatch(batch OperationBatch) {
	journal.batches = append(journal.batches, cloneBatch(batch))
	journal.operations[batch.OperationID] = operationEntry{batch: cloneBatch(batch), digest: batch.OperationDigest}
	journal.batchChecksums[batch.BatchID] = batch.Checksum
	journal.writerSequences[writerSequenceKey(batch.WriterID, batch.Sequence)] = batch.Checksum
}

func (journal *Journal) loadSegments() error {
	writersDir := filepath.Join(journal.root, "writers")
	writersInfo, err := os.Lstat(writersDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read flashcard writers info: %w", err)
	}
	if writersInfo.Mode()&fs.ModeSymlink != 0 || !writersInfo.IsDir() {
		return fmt.Errorf("%w: writers path is not a regular directory", ErrCorruptSegment)
	}
	writerEntries, err := os.ReadDir(writersDir)
	if err != nil {
		return fmt.Errorf("read flashcard writers: %w", err)
	}
	segmentChecksums := map[string]string{}
	for _, writerEntry := range writerEntries {
		if writerEntry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("%w: writer directory is a symbolic link", ErrCorruptSegment)
		}
		if !writerEntry.IsDir() {
			continue
		}
		writerID := writerEntry.Name()
		if _, parseErr := uuid.Parse(writerID); parseErr != nil {
			continue
		}
		segmentsDir := filepath.Join(writersDir, writerID, "segments")
		segmentsInfo, infoErr := os.Lstat(segmentsDir)
		if os.IsNotExist(infoErr) {
			continue
		}
		if infoErr != nil {
			return fmt.Errorf("read flashcard segments info: %w", infoErr)
		}
		if segmentsInfo.Mode()&fs.ModeSymlink != 0 || !segmentsInfo.IsDir() {
			return fmt.Errorf("%w: segments path is not a regular directory", ErrCorruptSegment)
		}
		entries, readErr := os.ReadDir(segmentsDir)
		if readErr != nil {
			return fmt.Errorf("read flashcard segments: %w", readErr)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("%w: segment is a symbolic link", ErrCorruptSegment)
			}
			path := filepath.Join(segmentsDir, entry.Name())
			segment, loadErr := loadSegment(path)
			if loadErr != nil {
				return loadErr
			}
			if segment.WriterID != writerID {
				return fmt.Errorf("%w: writer path and segment writer differ", ErrCorruptSegment)
			}
			if previous, ok := segmentChecksums[segment.SegmentID]; ok {
				if previous != segment.Checksum {
					return fmt.Errorf("%w: duplicate segment ID has different content", ErrCorruptSegment)
				}
				continue
			}
			segmentChecksums[segment.SegmentID] = segment.Checksum
			for _, batch := range segment.Batches {
				if err = journal.loadBatch(batch); err != nil {
					return fmt.Errorf("%w: %v", ErrCorruptSegment, err)
				}
			}
		}
	}
	sortBatches(journal.batches)
	for _, batch := range journal.batches {
		if batch.WriterID == journal.writerID && batch.Sequence > journal.nextSequence {
			journal.nextSequence = batch.Sequence
		}
	}
	return nil
}

func (journal *Journal) loadBatch(batch OperationBatch) error {
	if previous, ok := journal.batchChecksums[batch.BatchID]; ok {
		if previous != batch.Checksum {
			return errors.New("duplicate batch ID has different content")
		}
		return nil
	}
	sequenceKey := writerSequenceKey(batch.WriterID, batch.Sequence)
	if previous, ok := journal.writerSequences[sequenceKey]; ok && previous != batch.Checksum {
		return errors.New("writer sequence has different batches")
	}
	if previous, ok := journal.operations[batch.OperationID]; ok && previous.digest != batch.OperationDigest {
		return ErrOperationConflict
	}
	journal.registerBatch(batch)
	return nil
}

func loadSegment(path string) (Segment, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return Segment{}, fmt.Errorf("read flashcard segment info: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return Segment{}, fmt.Errorf("%w: segment is not a regular file", ErrCorruptSegment)
	}
	if info.Size() <= 0 || info.Size() > maxSegmentBytes {
		return Segment{}, fmt.Errorf("%w: invalid segment size [%d]", ErrCorruptSegment, info.Size())
	}
	data, err := filelock.ReadFile(path)
	if err != nil {
		return Segment{}, fmt.Errorf("read flashcard segment: %w", err)
	}
	var segment Segment
	if err = decodeStrictJSON(data, &segment); err != nil {
		return Segment{}, fmt.Errorf("%w: decode segment [%s]: %v", ErrCorruptSegment, path, err)
	}
	if err = validateSegment(&segment); err != nil {
		return Segment{}, fmt.Errorf("%w: validate segment [%s]: %v", ErrCorruptSegment, path, err)
	}
	return segment, nil
}

func validateSegment(segment *Segment) error {
	if segment.FormatVersion != FormatVersion {
		return fmt.Errorf("unsupported format version [%d]", segment.FormatVersion)
	}
	if _, err := uuid.Parse(segment.SegmentID); err != nil {
		return errors.New("invalid segment ID")
	}
	if _, err := uuid.Parse(segment.WriterID); err != nil {
		return errors.New("invalid writer ID")
	}
	if len(segment.Batches) == 0 {
		return errors.New("segment has no batches")
	}
	if segment.StartSequence == 0 || segment.EndSequence < segment.StartSequence {
		return errors.New("invalid segment sequence range")
	}
	for index := range segment.Batches {
		batch := &segment.Batches[index]
		if err := validateBatch(batch); err != nil {
			return err
		}
		expectedSequence := segment.StartSequence + uint64(index)
		if batch.WriterID != segment.WriterID || batch.Sequence != expectedSequence {
			return errors.New("segment batches are not a contiguous writer sequence")
		}
	}
	if segment.Batches[len(segment.Batches)-1].Sequence != segment.EndSequence {
		return errors.New("segment end sequence does not match its batches")
	}
	copy := *segment
	copy.Checksum = ""
	return validateChecksum(segment.Checksum, copy)
}

func validateBatch(batch *OperationBatch) error {
	if batch.FormatVersion != FormatVersion {
		return fmt.Errorf("unsupported batch format version [%d]", batch.FormatVersion)
	}
	if _, err := uuid.Parse(batch.BatchID); err != nil {
		return errors.New("invalid batch ID")
	}
	if _, err := uuid.Parse(batch.WriterID); err != nil {
		return errors.New("invalid batch writer ID")
	}
	if batch.OperationID == "" || len(batch.OperationID) > 512 || batch.OperationDigest == "" || batch.DeviceID == "" ||
		batch.Sequence == 0 || batch.RecordedAt < 0 {
		return errors.New("batch identity is incomplete")
	}
	if len(batch.Changes) == 0 {
		return errors.New("batch has no changes")
	}
	for index := range batch.Changes {
		if err := batch.Changes[index].Validate(); err != nil {
			return err
		}
	}
	digest, err := checksum(batch.Changes)
	if err != nil {
		return err
	}
	if digest != batch.OperationDigest {
		return errors.New("operation digest does not match changes")
	}
	copy := *batch
	copy.Checksum = ""
	return validateChecksum(batch.Checksum, copy)
}

func normalizeChanges(changes []Change) ([]Change, error) {
	if len(changes) == 0 {
		return nil, errors.New("operation must contain at least one change")
	}
	ret := make([]Change, len(changes))
	for index, change := range changes {
		ret[index] = change
		switch change.Kind {
		case RecordEntityRevision:
			if change.Revision == nil {
				return nil, errors.New("entity revision is required")
			}
			revision := *change.Revision
			revision.ParentRevisionIDs = append([]string(nil), revision.ParentRevisionIDs...)
			sort.Strings(revision.ParentRevisionIDs)
			payload, err := canonicalRawMessage(revision.Payload)
			if err != nil {
				return nil, fmt.Errorf("canonicalize entity payload: %w", err)
			}
			revision.Payload = payload
			ret[index].Revision = &revision
			ret[index].Event = nil
		case RecordEvent:
			if change.Event == nil {
				return nil, errors.New("event is required")
			}
			event := *change.Event
			payload, err := canonicalRawMessage(event.Payload)
			if err != nil {
				return nil, fmt.Errorf("canonicalize event payload: %w", err)
			}
			event.Payload = payload
			ret[index].Event = &event
			ret[index].Revision = nil
		default:
			return nil, fmt.Errorf("unsupported record kind [%s]", change.Kind)
		}
		if err := ret[index].Validate(); err != nil {
			return nil, err
		}
	}
	return ret, nil
}

func sealBatch(batch *OperationBatch) error {
	batch.Checksum = ""
	value := *batch
	digest, err := checksum(value)
	if err != nil {
		return fmt.Errorf("checksum flashcard batch: %w", err)
	}
	batch.Checksum = digest
	return nil
}

func sealSegment(segment *Segment) error {
	segment.Checksum = ""
	value := *segment
	digest, err := checksum(value)
	if err != nil {
		return fmt.Errorf("checksum flashcard segment: %w", err)
	}
	segment.Checksum = digest
	return nil
}

func (journal *Journal) writeSegment(path string, segment *Segment) error {
	if err := validateSegment(segment); err != nil {
		return fmt.Errorf("validate flashcard segment before writing: %w", err)
	}
	data, err := CanonicalJSON(segment)
	if err != nil {
		return fmt.Errorf("encode flashcard segment: %w", err)
	}
	data = append(data, '\n')
	if len(data) > journal.maxSegmentBytes {
		return errors.New("flashcard segment exceeds the maximum size")
	}
	if err = filelock.WriteFile(path, data); err != nil {
		return fmt.Errorf("write flashcard segment: %w", err)
	}
	return nil
}

func (journal *Journal) activeWouldExceedLimit(batch OperationBatch) (bool, error) {
	candidate := *journal.active
	candidate.Batches = append(append([]OperationBatch(nil), journal.active.Batches...), batch)
	candidate.EndSequence = batch.Sequence
	if err := sealSegment(&candidate); err != nil {
		return false, err
	}
	data, err := CanonicalJSON(candidate)
	if err != nil {
		return false, err
	}
	return len(data)+1 > journal.maxSegmentBytes, nil
}

func (journal *Journal) segmentsDir() string {
	return filepath.Join(journal.root, "writers", journal.writerID, "segments")
}

func (journal *Journal) openSegmentPath(segment *Segment) string {
	name := fmt.Sprintf("%020d-open-%s.json", segment.StartSequence, segment.SegmentID)
	return filepath.Join(journal.segmentsDir(), name)
}

func (journal *Journal) sealedSegmentPath(segment *Segment) string {
	name := fmt.Sprintf("%020d-%020d-%s.json", segment.StartSequence, segment.EndSequence, segment.SegmentID)
	return filepath.Join(journal.segmentsDir(), name)
}

func sortBatches(batches []OperationBatch) {
	sort.Slice(batches, func(i, j int) bool {
		if batches[i].WriterID != batches[j].WriterID {
			return batches[i].WriterID < batches[j].WriterID
		}
		if batches[i].Sequence != batches[j].Sequence {
			return batches[i].Sequence < batches[j].Sequence
		}
		if batches[i].RecordedAt != batches[j].RecordedAt {
			return batches[i].RecordedAt < batches[j].RecordedAt
		}
		return batches[i].BatchID < batches[j].BatchID
	})
}

func cloneBatch(batch OperationBatch) OperationBatch {
	data, err := json.Marshal(batch)
	if err != nil {
		panic(err)
	}
	var cloned OperationBatch
	if err = json.Unmarshal(data, &cloned); err != nil {
		panic(err)
	}
	return cloned
}

func writerSequenceKey(writerID string, sequence uint64) string {
	return fmt.Sprintf("%s:%020d", writerID, sequence)
}
