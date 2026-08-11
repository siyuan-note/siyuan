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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mattn/go-sqlite3"
)

const flashcardSQLiteDriver = "sqlite3_flashcard"

func init() {
	sql.Register(flashcardSQLiteDriver, &sqlite3.SQLiteDriver{ConnectHook: func(connection *sqlite3.SQLiteConn) error {
		return connection.RegisterFunc("flashcard_retrievability", projectedRetrievability, true)
	}})
}

// ErrProjectionConflict 表示同一权威 ID 在投影中出现了不同内容。
var ErrProjectionConflict = errors.New("flashcard projection contains conflicting immutable records")

// EntityConflict 描述两个并发实体修订及当前选中结果。
type EntityConflict struct {
	EntityType         EntityType
	EntityID           string
	RevisionID         string
	SelectedRevisionID string
	DetectedAt         int64
}

// Projection 管理可删除、可重建的本地 SQLite 投影。
type Projection struct {
	db     *sql.DB
	mu     sync.Mutex
	closed bool
}

var projectionSchema = []string{
	`CREATE TABLE IF NOT EXISTS applied_changes (
		operation_id TEXT PRIMARY KEY,
		operation_digest TEXT NOT NULL,
		canonical_batch_id TEXT NOT NULL,
		applied_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS operation_batches (
		batch_id TEXT PRIMARY KEY,
		operation_id TEXT NOT NULL,
		operation_digest TEXT NOT NULL,
		device_id TEXT NOT NULL,
		writer_id TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		recorded_at INTEGER NOT NULL,
		checksum TEXT NOT NULL,
		UNIQUE(writer_id, sequence)
	)`,
	`CREATE TABLE IF NOT EXISTS entity_revisions (
		revision_id TEXT PRIMARY KEY,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		parent_revision_ids TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		deleted INTEGER NOT NULL,
		payload BLOB NOT NULL,
		revision_digest TEXT NOT NULL,
		batch_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_entity_revisions_entity ON entity_revisions(entity_type, entity_id, updated_at)`,
	`CREATE TABLE IF NOT EXISTS revision_parents (
		revision_id TEXT NOT NULL,
		parent_revision_id TEXT NOT NULL,
		PRIMARY KEY(revision_id, parent_revision_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_revision_parents_parent ON revision_parents(parent_revision_id)`,
	`CREATE TABLE IF NOT EXISTS entities (
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		revision_id TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		deleted INTEGER NOT NULL,
		payload BLOB NOT NULL,
		PRIMARY KEY(entity_type, entity_id)
	)`,
	`CREATE TABLE IF NOT EXISTS entity_conflicts (
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		revision_id TEXT NOT NULL,
		selected_revision_id TEXT NOT NULL,
		detected_at INTEGER NOT NULL,
		resolved INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY(entity_type, entity_id, revision_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_entity_conflicts_unresolved ON entity_conflicts(resolved, entity_type, entity_id)`,
	`CREATE TABLE IF NOT EXISTS events (
		event_id TEXT PRIMARY KEY,
		event_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		occurred_at INTEGER NOT NULL,
		payload BLOB NOT NULL,
		event_digest TEXT NOT NULL,
		batch_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_events_entity_time ON events(entity_id, occurred_at)`,
	`CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, occurred_at)`,
	`CREATE TABLE IF NOT EXISTS writer_sequences (
		writer_id TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		batch_id TEXT NOT NULL,
		checksum TEXT NOT NULL,
		PRIMARY KEY(writer_id, sequence)
	)`,
	`CREATE TABLE IF NOT EXISTS writer_high_watermarks (
		writer_id TEXT PRIMARY KEY,
		sequence INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS projection_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
}

// OpenProjection 打开或创建 SQLite 投影。
func OpenProjection(path string) (*Projection, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("flashcard projection path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("create flashcard projection directory: %w", err)
	}
	dsn := path + "?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=7000"
	db, err := sql.Open(flashcardSQLiteDriver, dsn)
	if err != nil {
		return nil, fmt.Errorf("open flashcard projection: %w", err)
	}
	db.SetMaxOpenConns(1)
	projection := &Projection{db: db}
	if err = projection.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return projection, nil
}

func (projection *Projection) initialize() error {
	if err := projection.db.Ping(); err != nil {
		return fmt.Errorf("ping flashcard projection: %w", err)
	}
	var version int
	if err := projection.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read flashcard projection version: %w", err)
	}
	if version != 0 && version != ProjectionSchemaVersion {
		return fmt.Errorf("unsupported flashcard projection version [%d]", version)
	}
	tx, err := projection.db.Begin()
	if err != nil {
		return fmt.Errorf("begin flashcard projection schema transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statements := allProjectionSchema()
	for _, statement := range statements {
		if _, err = tx.Exec(statement); err != nil {
			return fmt.Errorf("initialize flashcard projection schema: %w", err)
		}
	}
	schemaDigest, err := projectionSchemaDigest()
	if err != nil {
		return fmt.Errorf("digest flashcard projection schema: %w", err)
	}
	if _, err = tx.Exec(`INSERT INTO projection_meta(key, value) VALUES ('schema_digest', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, schemaDigest); err != nil {
		return fmt.Errorf("write flashcard projection schema digest: %w", err)
	}
	if _, err = tx.Exec(fmt.Sprintf("PRAGMA user_version=%d", ProjectionSchemaVersion)); err != nil {
		return fmt.Errorf("write flashcard projection version: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard projection schema: %w", err)
	}
	return nil
}

// ApplyBatch 在一个 SQLite 事务中幂等应用完整操作批次。
func (projection *Projection) ApplyBatch(ctx context.Context, batch OperationBatch) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	if err := validateBatch(&batch); err != nil {
		return err
	}
	tx, err := projection.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin flashcard projection transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	alreadyApplied, err := validateExistingBatch(ctx, tx, batch)
	if err != nil {
		return err
	}
	if alreadyApplied {
		return tx.Commit()
	}
	operationExists, err := ensureOperation(ctx, tx, batch)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operation_batches
		(batch_id, operation_id, operation_digest, device_id, writer_id, sequence, recorded_at, checksum)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, batch.BatchID, batch.OperationID, batch.OperationDigest, batch.DeviceID,
		batch.WriterID, batch.Sequence, batch.RecordedAt, batch.Checksum); err != nil {
		return fmt.Errorf("insert flashcard operation batch: %w", err)
	}
	if !operationExists {
		for index := range batch.Changes {
			change := &batch.Changes[index]
			switch change.Kind {
			case RecordEntityRevision:
				if err = applyRevision(ctx, tx, batch, change.Revision); err != nil {
					return err
				}
			case RecordEvent:
				if err = applyEvent(ctx, tx, batch, change.Event); err != nil {
					return err
				}
			default:
				return fmt.Errorf("unsupported flashcard record kind [%s]", change.Kind)
			}
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO writer_sequences(writer_id, sequence, batch_id, checksum)
		VALUES (?, ?, ?, ?)`, batch.WriterID, batch.Sequence, batch.BatchID, batch.Checksum); err != nil {
		return fmt.Errorf("insert flashcard writer sequence: %w", err)
	}
	if err = advanceHighWatermark(ctx, tx, batch.WriterID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard projection transaction: %w", err)
	}
	return nil
}

// ValidateChanges 在不提交数据的事务中预检即将写入权威日志的记录。
func (projection *Projection) ValidateChanges(ctx context.Context, changes []Change) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	normalizedChanges, err := normalizeChanges(changes)
	if err != nil {
		return err
	}
	tx, err := projection.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin flashcard projection validation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	validationBatch := OperationBatch{BatchID: "validation"}
	for index := range normalizedChanges {
		change := &normalizedChanges[index]
		switch change.Kind {
		case RecordEntityRevision:
			if err = applyRevision(ctx, tx, validationBatch, change.Revision); err != nil {
				return err
			}
		case RecordEvent:
			if err = applyEvent(ctx, tx, validationBatch, change.Event); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported flashcard record kind [%s]", change.Kind)
		}
	}
	return nil
}

// ValidateBusinessChanges 在不提交数据的事务中校验实体之间的引用完整性。
func (projection *Projection) ValidateBusinessChanges(ctx context.Context, changes []Change) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	normalizedChanges, err := normalizeChanges(changes)
	if err != nil {
		return err
	}
	tx, err := projection.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin flashcard business validation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	validationBatch := OperationBatch{BatchID: "business-validation"}
	for index := range normalizedChanges {
		change := &normalizedChanges[index]
		switch change.Kind {
		case RecordEntityRevision:
			if err = applyRevision(ctx, tx, validationBatch, change.Revision); err != nil {
				return err
			}
		case RecordEvent:
			if err = applyEvent(ctx, tx, validationBatch, change.Event); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported flashcard record kind [%s]", change.Kind)
		}
	}
	return validateBusinessReferences(ctx, tx)
}

func validateExistingBatch(ctx context.Context, tx *sql.Tx, batch OperationBatch) (bool, error) {
	var checksum string
	err := tx.QueryRowContext(ctx, "SELECT checksum FROM operation_batches WHERE batch_id = ?", batch.BatchID).Scan(&checksum)
	if err == nil {
		if checksum != batch.Checksum {
			return false, ErrProjectionConflict
		}
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("query flashcard operation batch: %w", err)
	}
	var existingBatchID, existingChecksum string
	err = tx.QueryRowContext(ctx, "SELECT batch_id, checksum FROM operation_batches WHERE writer_id = ? AND sequence = ?",
		batch.WriterID, batch.Sequence).Scan(&existingBatchID, &existingChecksum)
	if err == nil {
		if existingBatchID != batch.BatchID || existingChecksum != batch.Checksum {
			return false, ErrProjectionConflict
		}
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("query flashcard writer sequence: %w", err)
	}
	return false, nil
}

func ensureOperation(ctx context.Context, tx *sql.Tx, batch OperationBatch) (bool, error) {
	var digest string
	err := tx.QueryRowContext(ctx, "SELECT operation_digest FROM applied_changes WHERE operation_id = ?", batch.OperationID).
		Scan(&digest)
	if err == nil {
		if digest != batch.OperationDigest {
			return false, ErrOperationConflict
		}
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("query flashcard operation: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO applied_changes(operation_id, operation_digest, canonical_batch_id, applied_at)
		VALUES (?, ?, ?, ?)`, batch.OperationID, batch.OperationDigest, batch.BatchID, time.Now().UnixMilli()); err != nil {
		return false, fmt.Errorf("insert flashcard operation: %w", err)
	}
	return false, nil
}

func applyRevision(ctx context.Context, tx *sql.Tx, batch OperationBatch, revision *EntityRevision) error {
	digest, err := checksum(revision)
	if err != nil {
		return err
	}
	parentsJSON, err := CanonicalJSON(revision.ParentRevisionIDs)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO entity_revisions
		(revision_id, entity_type, entity_id, parent_revision_ids, updated_at, deleted, payload, revision_digest, batch_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, revision.RevisionID, revision.EntityType, revision.EntityID, parentsJSON,
		revision.UpdatedAt, revision.Deleted, []byte(revision.Payload), digest, batch.BatchID)
	if err != nil {
		return fmt.Errorf("insert flashcard entity revision: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read inserted flashcard revision count: %w", err)
	}
	if inserted == 0 {
		var existingDigest string
		if err = tx.QueryRowContext(ctx, "SELECT revision_digest FROM entity_revisions WHERE revision_id = ?",
			revision.RevisionID).Scan(&existingDigest); err != nil {
			return fmt.Errorf("query existing flashcard revision: %w", err)
		}
		if existingDigest != digest {
			return ErrProjectionConflict
		}
		return nil
	}
	for _, parentID := range revision.ParentRevisionIDs {
		if err = validateRevisionRelation(ctx, tx, revision, parentID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO revision_parents(revision_id, parent_revision_id) VALUES (?, ?)",
			revision.RevisionID, parentID); err != nil {
			return fmt.Errorf("insert flashcard revision parent: %w", err)
		}
	}
	if err = validateWaitingChildren(ctx, tx, revision); err != nil {
		return err
	}
	for _, parentID := range revision.ParentRevisionIDs {
		cycle, cycleErr := isAncestorRevision(ctx, tx, revision.RevisionID, parentID)
		if cycleErr != nil {
			return cycleErr
		}
		if cycle {
			return errors.New("flashcard revision graph contains a cycle")
		}
	}
	return selectCurrentRevision(ctx, tx, revision)
}

func validateRevisionRelation(ctx context.Context, tx *sql.Tx, revision *EntityRevision, parentID string) error {
	var entityType, entityID string
	err := tx.QueryRowContext(ctx, "SELECT entity_type, entity_id FROM entity_revisions WHERE revision_id = ?", parentID).
		Scan(&entityType, &entityID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("query flashcard parent revision: %w", err)
	}
	if entityType != string(revision.EntityType) || entityID != revision.EntityID {
		return errors.New("flashcard parent revision belongs to another entity")
	}
	return nil
}

func validateWaitingChildren(ctx context.Context, tx *sql.Tx, revision *EntityRevision) error {
	rows, err := tx.QueryContext(ctx, `SELECT r.entity_type, r.entity_id
		FROM revision_parents p JOIN entity_revisions r ON r.revision_id = p.revision_id
		WHERE p.parent_revision_id = ?`, revision.RevisionID)
	if err != nil {
		return fmt.Errorf("query waiting flashcard child revisions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var entityType, entityID string
		if err = rows.Scan(&entityType, &entityID); err != nil {
			return fmt.Errorf("scan waiting flashcard child revision: %w", err)
		}
		if entityType != string(revision.EntityType) || entityID != revision.EntityID {
			return errors.New("flashcard child revision belongs to another entity")
		}
	}
	return rows.Err()
}

func selectCurrentRevision(ctx context.Context, tx *sql.Tx, revision *EntityRevision) error {
	var currentID string
	var currentUpdatedAt int64
	var currentDeleted bool
	err := tx.QueryRowContext(ctx, `SELECT revision_id, updated_at, deleted FROM entities
		WHERE entity_type = ? AND entity_id = ?`, revision.EntityType, revision.EntityID).
		Scan(&currentID, &currentUpdatedAt, &currentDeleted)
	if errors.Is(err, sql.ErrNoRows) {
		return upsertCurrentRevision(ctx, tx, revision)
	}
	if err != nil {
		return fmt.Errorf("query current flashcard entity: %w", err)
	}
	if currentID == revision.RevisionID {
		return nil
	}
	currentIsAncestor, err := isAncestorRevision(ctx, tx, currentID, revision.RevisionID)
	if err != nil {
		return err
	}
	if currentIsAncestor {
		if err = upsertCurrentRevision(ctx, tx, revision); err != nil {
			return err
		}
		return resolveEntityConflicts(ctx, tx, revision)
	}
	incomingIsAncestor, err := isAncestorRevision(ctx, tx, revision.RevisionID, currentID)
	if err != nil {
		return err
	}
	if incomingIsAncestor {
		return nil
	}
	selectedID := currentID
	selectIncoming := revisionWins(revision.Deleted, revision.UpdatedAt, revision.RevisionID, currentDeleted, currentUpdatedAt, currentID)
	if selectIncoming {
		selectedID = revision.RevisionID
		if err = upsertCurrentRevision(ctx, tx, revision); err != nil {
			return err
		}
	}
	detectedAt := time.Now().UnixMilli()
	if _, err = tx.ExecContext(ctx, `UPDATE entity_conflicts SET selected_revision_id = ?
		WHERE entity_type = ? AND entity_id = ? AND resolved = 0`, selectedID, revision.EntityType,
		revision.EntityID); err != nil {
		return fmt.Errorf("update flashcard entity conflicts: %w", err)
	}
	for _, conflictRevisionID := range []string{currentID, revision.RevisionID} {
		if _, err = tx.ExecContext(ctx, `INSERT INTO entity_conflicts
			(entity_type, entity_id, revision_id, selected_revision_id, detected_at, resolved)
			VALUES (?, ?, ?, ?, ?, 0)
			ON CONFLICT(entity_type, entity_id, revision_id) DO UPDATE SET
			selected_revision_id = excluded.selected_revision_id, detected_at = excluded.detected_at, resolved = 0`,
			revision.EntityType, revision.EntityID, conflictRevisionID, selectedID, detectedAt); err != nil {
			return fmt.Errorf("record flashcard entity conflict: %w", err)
		}
	}
	return nil
}

func resolveEntityConflicts(ctx context.Context, tx *sql.Tx, revision *EntityRevision) error {
	rows, err := tx.QueryContext(ctx, `SELECT revision_id FROM entity_conflicts
		WHERE entity_type = ? AND entity_id = ? AND resolved = 0`, revision.EntityType, revision.EntityID)
	if err != nil {
		return fmt.Errorf("query unresolved flashcard entity conflicts: %w", err)
	}
	var conflictRevisionIDs []string
	for rows.Next() {
		var revisionID string
		if err = rows.Scan(&revisionID); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan unresolved flashcard entity conflict: %w", err)
		}
		conflictRevisionIDs = append(conflictRevisionIDs, revisionID)
	}
	if err = rows.Close(); err != nil {
		return fmt.Errorf("close unresolved flashcard entity conflicts: %w", err)
	}
	if len(conflictRevisionIDs) == 0 {
		return nil
	}
	for _, conflictRevisionID := range conflictRevisionIDs {
		resolved, resolveErr := isAncestorRevision(ctx, tx, conflictRevisionID, revision.RevisionID)
		if resolveErr != nil {
			return resolveErr
		}
		if !resolved {
			return nil
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE entity_conflicts
		SET selected_revision_id = ?, resolved = 1
		WHERE entity_type = ? AND entity_id = ? AND resolved = 0`, revision.RevisionID, revision.EntityType,
		revision.EntityID); err != nil {
		return fmt.Errorf("resolve flashcard entity conflicts: %w", err)
	}
	return nil
}

func revisionWins(incomingDeleted bool, incomingUpdatedAt int64, incomingID string, currentDeleted bool,
	currentUpdatedAt int64, currentID string) bool {
	if incomingDeleted != currentDeleted {
		return incomingDeleted
	}
	if incomingUpdatedAt != currentUpdatedAt {
		return incomingUpdatedAt > currentUpdatedAt
	}
	return incomingID > currentID
}

func upsertCurrentRevision(ctx context.Context, tx *sql.Tx, revision *EntityRevision) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO entities(entity_type, entity_id, revision_id, updated_at, deleted, payload)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(entity_type, entity_id) DO UPDATE SET revision_id = excluded.revision_id,
		updated_at = excluded.updated_at, deleted = excluded.deleted, payload = excluded.payload`, revision.EntityType,
		revision.EntityID, revision.RevisionID, revision.UpdatedAt, revision.Deleted, []byte(revision.Payload))
	if err != nil {
		return fmt.Errorf("upsert current flashcard entity: %w", err)
	}
	return projectCurrentEntity(ctx, tx, revision)
}

func isAncestorRevision(ctx context.Context, tx *sql.Tx, ancestorID, descendantID string) (bool, error) {
	if ancestorID == descendantID {
		return true, nil
	}
	visited := map[string]struct{}{}
	queue := []string{descendantID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if _, ok := visited[current]; ok {
			continue
		}
		visited[current] = struct{}{}
		if len(visited) > 100000 {
			return false, errors.New("flashcard revision graph exceeds traversal limit")
		}
		rows, err := tx.QueryContext(ctx, "SELECT parent_revision_id FROM revision_parents WHERE revision_id = ?", current)
		if err != nil {
			return false, fmt.Errorf("query flashcard revision parents: %w", err)
		}
		var parents []string
		for rows.Next() {
			var parent string
			if err = rows.Scan(&parent); err != nil {
				_ = rows.Close()
				return false, fmt.Errorf("scan flashcard revision parent: %w", err)
			}
			parents = append(parents, parent)
		}
		if err = rows.Close(); err != nil {
			return false, fmt.Errorf("close flashcard revision parent rows: %w", err)
		}
		for _, parent := range parents {
			if parent == ancestorID {
				return true, nil
			}
			queue = append(queue, parent)
		}
	}
	return false, nil
}

func applyEvent(ctx context.Context, tx *sql.Tx, batch OperationBatch, event *Event) error {
	digest, err := checksum(event)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO events
		(event_id, event_type, entity_id, occurred_at, payload, event_digest, batch_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, event.EventID, event.EventType, event.EntityID, event.OccurredAt,
		[]byte(event.Payload), digest, batch.BatchID)
	if err != nil {
		return fmt.Errorf("insert flashcard event: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read inserted flashcard event count: %w", err)
	}
	if inserted == 0 {
		var existingDigest string
		if err = tx.QueryRowContext(ctx, "SELECT event_digest FROM events WHERE event_id = ?", event.EventID).
			Scan(&existingDigest); err != nil {
			return fmt.Errorf("query existing flashcard event: %w", err)
		}
		if existingDigest != digest {
			return ErrProjectionConflict
		}
	}
	return projectReviewEvent(ctx, tx, batch, event)
}

func advanceHighWatermark(ctx context.Context, tx *sql.Tx, writerID string) error {
	var highWatermark uint64
	err := tx.QueryRowContext(ctx, "SELECT sequence FROM writer_high_watermarks WHERE writer_id = ?", writerID).
		Scan(&highWatermark)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("query flashcard writer high watermark: %w", err)
	}
	for {
		var exists int
		err = tx.QueryRowContext(ctx, "SELECT 1 FROM writer_sequences WHERE writer_id = ? AND sequence = ?", writerID,
			highWatermark+1).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return fmt.Errorf("query next flashcard writer sequence: %w", err)
		}
		highWatermark++
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO writer_high_watermarks(writer_id, sequence) VALUES (?, ?)
		ON CONFLICT(writer_id) DO UPDATE SET sequence = excluded.sequence`, writerID, highWatermark); err != nil {
		return fmt.Errorf("update flashcard writer high watermark: %w", err)
	}
	return nil
}

// CurrentEntity 返回实体的当前投影。
func (projection *Projection) CurrentEntity(ctx context.Context, entityType EntityType, entityID string) (EntityRevision, bool, error) {
	var revision EntityRevision
	var payload []byte
	err := projection.db.QueryRowContext(ctx, `SELECT revision_id, updated_at, deleted, payload FROM entities
		WHERE entity_type = ? AND entity_id = ?`, entityType, entityID).
		Scan(&revision.RevisionID, &revision.UpdatedAt, &revision.Deleted, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return EntityRevision{}, false, nil
	}
	if err != nil {
		return EntityRevision{}, false, fmt.Errorf("query current flashcard entity: %w", err)
	}
	revision.EntityType = entityType
	revision.EntityID = entityID
	revision.Payload = json.RawMessage(payload)
	return revision, true, nil
}

// OperationCount 返回已投影的逻辑操作数量。
func (projection *Projection) OperationCount(ctx context.Context) (int, error) {
	return projection.count(ctx, "applied_changes")
}

// BatchCount 返回已投影的物理操作批次数量。
func (projection *Projection) BatchCount(ctx context.Context) (int, error) {
	return projection.count(ctx, "operation_batches")
}

// EventCount 返回已投影的不可变事件数量。
func (projection *Projection) EventCount(ctx context.Context) (int, error) {
	return projection.count(ctx, "events")
}

// ConflictCount 返回尚未消解的实体冲突数量。
func (projection *Projection) ConflictCount(ctx context.Context) (int, error) {
	var count int
	err := projection.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM entity_conflicts WHERE resolved = 0").Scan(&count)
	return count, err
}

// HighWatermark 返回写入者已经连续应用的最大序列号。
func (projection *Projection) HighWatermark(ctx context.Context, writerID string) (uint64, error) {
	var sequence uint64
	err := projection.db.QueryRowContext(ctx, "SELECT sequence FROM writer_high_watermarks WHERE writer_id = ?", writerID).
		Scan(&sequence)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return sequence, err
}

func (projection *Projection) count(ctx context.Context, table string) (int, error) {
	var count int
	err := projection.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count)
	return count, err
}

// QuickCheck 验证 SQLite 文件的基本完整性。
func (projection *Projection) QuickCheck(ctx context.Context) error {
	var result string
	if err := projection.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&result); err != nil {
		return fmt.Errorf("check flashcard projection: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("flashcard projection integrity check failed: %s", result)
	}
	return nil
}

// Close 关闭 SQLite 投影。
func (projection *Projection) Close() error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return nil
	}
	projection.closed = true
	var busy, logFrames, checkpointedFrames int
	checkpointErr := projection.db.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").
		Scan(&busy, &logFrames, &checkpointedFrames)
	if checkpointErr == nil && (busy != 0 || checkpointedFrames < logFrames) {
		checkpointErr = fmt.Errorf("flashcard projection WAL checkpoint is incomplete: busy=%d log=%d checkpointed=%d",
			busy, logFrames, checkpointedFrames)
	}
	closeErr := projection.db.Close()
	return errors.Join(checkpointErr, closeErr)
}

// ProjectionNeedsRebuild 判断投影是否缺失、损坏或版本不兼容。
func ProjectionNeedsRebuild(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return true
	}
	db, err := sql.Open("sqlite3", path+"?mode=ro&_busy_timeout=1000")
	if err != nil {
		return true
	}
	defer db.Close()
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != ProjectionSchemaVersion {
		return true
	}
	expectedDigest, err := projectionSchemaDigest()
	if err != nil {
		return true
	}
	var actualDigest string
	if err = db.QueryRow("SELECT value FROM projection_meta WHERE key = 'schema_digest'").Scan(&actualDigest); err != nil ||
		actualDigest != expectedDigest {
		return true
	}
	for _, object := range allRequiredProjectionObjects() {
		var found int
		if err = db.QueryRow("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?", object.typ, object.name).
			Scan(&found); err != nil {
			return true
		}
	}
	var result string
	return db.QueryRow("PRAGMA quick_check").Scan(&result) != nil || result != "ok"
}

// RebuildProjection 从权威批次原子重建 SQLite 投影。
func RebuildProjection(ctx context.Context, path string, batches []OperationBatch) error {
	return rebuildProjection(ctx, path, batches, "")
}

// RebuildProjectionWithSnapshots 优先使用校验通过的不可变快照，再重放全部权威批次。
func RebuildProjectionWithSnapshots(ctx context.Context, path string, batches []OperationBatch,
	snapshotsRoot string) error {
	return rebuildProjection(ctx, path, batches, snapshotsRoot)
}

func rebuildProjection(ctx context.Context, path string, batches []OperationBatch, snapshotsRoot string) error {
	rebuildPath := projectionCompanionPath(path, "rebuild")
	backupPath := projectionCompanionPath(path, "backup")
	if err := removeProjectionFiles(rebuildPath); err != nil {
		return err
	}
	if snapshotsRoot != "" {
		snapshot, found, err := BestSnapshot(snapshotsRoot)
		if err != nil {
			return err
		}
		if found {
			covered, coverErr := snapshotCoveredByBatches(ctx, snapshot.Path, batches)
			if coverErr == nil && covered {
				if err = copyProjectionFile(snapshot.Path, rebuildPath); err != nil {
					return err
				}
			}
		}
	}
	projection, err := OpenProjection(rebuildPath)
	if err != nil {
		return err
	}
	closeProjection := true
	defer func() {
		if closeProjection {
			_ = projection.Close()
		}
	}()
	for _, batch := range batches {
		if err = projection.ApplyBatch(ctx, batch); err != nil {
			return fmt.Errorf("replay flashcard operation [%s]: %w", batch.OperationID, err)
		}
	}
	if err = projection.QuickCheck(ctx); err != nil {
		return err
	}
	if err = projection.Close(); err != nil {
		return fmt.Errorf("close rebuilt flashcard projection: %w", err)
	}
	closeProjection = false
	if err = removeProjectionFiles(backupPath); err != nil {
		return err
	}
	if err = removeProjectionSidecars(path); err != nil {
		return err
	}
	targetExists := false
	if _, statErr := os.Stat(path); statErr == nil {
		targetExists = true
		if err = os.Rename(path, backupPath); err != nil {
			return fmt.Errorf("back up flashcard projection before replacement: %w", err)
		}
	} else if !os.IsNotExist(statErr) {
		return fmt.Errorf("inspect flashcard projection before replacement: %w", statErr)
	}
	if err = os.Rename(rebuildPath, path); err != nil {
		if targetExists {
			if rollbackErr := os.Rename(backupPath, path); rollbackErr != nil {
				return errors.Join(fmt.Errorf("activate rebuilt flashcard projection: %w", err),
					fmt.Errorf("restore previous flashcard projection: %w", rollbackErr))
			}
		}
		return fmt.Errorf("activate rebuilt flashcard projection: %w", err)
	}
	if err = removeProjectionFiles(backupPath); err != nil {
		return err
	}
	_ = removeProjectionFiles(rebuildPath)
	return nil
}

func projectionCompanionPath(path, label string) string {
	extension := filepath.Ext(path)
	if extension == "" {
		return path + "." + label
	}
	return strings.TrimSuffix(path, extension) + "." + label + extension
}

func removeProjectionSidecars(path string) error {
	for _, candidate := range []string{path + "-wal", path + "-shm"} {
		if err := os.Remove(candidate); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove flashcard projection sidecar [%s]: %w", candidate, err)
		}
	}
	return nil
}

func removeProjectionFiles(path string) error {
	if strings.TrimSpace(path) == "" || filepath.Clean(path) == "." {
		return errors.New("invalid flashcard projection path")
	}
	if err := removeProjectionSidecars(path); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove flashcard projection file [%s]: %w", path, err)
	}
	return nil
}
