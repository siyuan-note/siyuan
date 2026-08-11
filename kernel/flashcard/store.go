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
	"errors"
	"fmt"
	"path/filepath"
	"sync"
)

// Store 组合权威日志和本地 SQLite 投影。
type Store struct {
	journal        *Journal
	projection     *Projection
	projectionPath string
	mu             sync.Mutex
	closed         bool
}

// V2Root 返回闪卡权威数据目录。
func V2Root(dataDir string) string {
	return filepath.Join(dataDir, "storage", "riff", "v2")
}

// ProjectionPath 返回可删除的闪卡 SQLite 投影路径。
func ProjectionPath(tempDir string) string {
	return filepath.Join(tempDir, "flashcards.db")
}

// OpenStore 打开闪卡 v2 存储，并在需要时从权威日志重建投影。
func OpenStore(ctx context.Context, journalRoot, projectionPath, deviceID string, options *JournalOptions) (*Store, error) {
	journal, err := OpenJournal(journalRoot, deviceID, options)
	if err != nil {
		return nil, err
	}
	batches := journal.Batches()
	if ProjectionNeedsRebuild(projectionPath) {
		if err = RebuildProjectionWithSnapshots(ctx, projectionPath, batches, SnapshotRoot(journalRoot)); err != nil {
			_ = journal.Close()
			return nil, err
		}
	}
	projection, err := OpenProjection(projectionPath)
	if err != nil {
		_ = journal.Close()
		return nil, err
	}
	for _, batch := range batches {
		if err = projection.ApplyBatch(ctx, batch); err != nil {
			_ = projection.Close()
			_ = journal.Close()
			return nil, fmt.Errorf("catch up flashcard projection: %w", err)
		}
	}
	store := &Store{journal: journal, projection: projection, projectionPath: projectionPath}
	if _, err = store.resolveReviewConflictsLocked(ctx); err != nil {
		_ = projection.Close()
		_ = journal.Close()
		return nil, err
	}
	return store, nil
}

// Apply 先持久化权威操作批次，再更新本地 SQLite 投影。
func (store *Store) Apply(ctx context.Context, operationID string, changes []Change) (OperationBatch, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.applyLocked(ctx, operationID, changes)
}

func (store *Store) applyLocked(ctx context.Context, operationID string, changes []Change) (OperationBatch, error) {
	if store.closed {
		return OperationBatch{}, errors.New("flashcard store is closed")
	}
	normalizedChanges, err := normalizeChanges(changes)
	if err != nil {
		return OperationBatch{}, err
	}
	digest, err := checksum(normalizedChanges)
	if err != nil {
		return OperationBatch{}, err
	}
	if existing, ok := store.journal.FindOperation(operationID); ok {
		if existing.OperationDigest != digest {
			return OperationBatch{}, ErrOperationConflict
		}
		if err = store.projection.ApplyBatch(ctx, existing); err != nil {
			return existing, fmt.Errorf("apply existing flashcard projection: %w", err)
		}
		return existing, nil
	}
	if err = store.projection.ValidateChanges(ctx, normalizedChanges); err != nil {
		return OperationBatch{}, fmt.Errorf("validate flashcard changes: %w", err)
	}
	batch, _, err := store.journal.Append(operationID, normalizedChanges)
	if err != nil {
		return OperationBatch{}, err
	}
	if err = store.projection.ApplyBatch(ctx, batch); err != nil {
		return batch, fmt.Errorf("apply flashcard projection: %w", err)
	}
	return batch, nil
}

// Refresh 导入同步后新增的权威分段，并幂等推进本地 SQLite 投影。
func (store *Store) Refresh(ctx context.Context) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return errors.New("flashcard store is closed")
	}
	if err := store.journal.Reload(); err != nil {
		return fmt.Errorf("reload flashcard journal: %w", err)
	}
	for _, batch := range store.journal.Batches() {
		if err := store.projection.ApplyBatch(ctx, batch); err != nil {
			return fmt.Errorf("refresh flashcard projection with operation [%s]: %w", batch.OperationID, err)
		}
	}
	_, err := store.resolveReviewConflictsLocked(ctx)
	return err
}

// RebuildProjection 删除并从权威日志重建当前 SQLite 投影。
func (store *Store) RebuildProjection(ctx context.Context) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return errors.New("flashcard store is closed")
	}
	if err := store.projection.Close(); err != nil {
		return err
	}
	if err := RebuildProjectionWithSnapshots(ctx, store.projectionPath, store.journal.Batches(),
		SnapshotRoot(store.journal.root)); err != nil {
		projection, openErr := OpenProjection(store.projectionPath)
		if openErr == nil {
			store.projection = projection
			return err
		}
		store.closed = true
		return errors.Join(err, fmt.Errorf("reopen flashcard projection after failed rebuild: %w", openErr))
	}
	projection, err := OpenProjection(store.projectionPath)
	if err != nil {
		store.closed = true
		return err
	}
	store.projection = projection
	return nil
}

// Projection 返回查询当前状态所用的本地投影。
func (store *Store) Projection() *Projection {
	return store.projection
}

// WriterID 返回当前运行实例的写入者 ID。
func (store *Store) WriterID() string {
	return store.journal.WriterID()
}

// Close 封存权威日志并关闭 SQLite 投影。
func (store *Store) Close() error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.closed = true
	journalErr := store.journal.Close()
	projectionErr := store.projection.Close()
	return errors.Join(journalErr, projectionErr)
}
