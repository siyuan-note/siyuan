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
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// SnapshotInfo 描述一个校验通过的不可变投影快照。
type SnapshotInfo struct {
	Path       string
	WriterID   string
	CreatedAt  int64
	Hash       string
	BatchCount int64
}

// CreateSnapshotIfNeeded 在没有可用快照或权威批次增长达到阈值时创建快照。
func (store *Store) CreateSnapshotIfNeeded(ctx context.Context, minimumBatchDelta int64) (SnapshotInfo, bool, error) {
	if minimumBatchDelta < 1 {
		return SnapshotInfo{}, false, errors.New("flashcard snapshot batch delta must be positive")
	}
	store.mu.Lock()
	if store.closed {
		store.mu.Unlock()
		return SnapshotInfo{}, false, errors.New("flashcard store is closed")
	}
	root := SnapshotRoot(store.journal.root)
	var batchCount int64
	err := store.projection.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM operation_batches").Scan(&batchCount)
	store.mu.Unlock()
	if err != nil {
		return SnapshotInfo{}, false, fmt.Errorf("count flashcard snapshot batches: %w", err)
	}
	best, found, err := BestSnapshot(root)
	if err != nil {
		return SnapshotInfo{}, false, err
	}
	if found && batchCount-best.BatchCount < minimumBatchDelta {
		return best, false, nil
	}
	created, err := store.CreateSnapshot(ctx)
	return created, err == nil, err
}

// SnapshotRoot 返回闪卡不可变快照目录。
func SnapshotRoot(journalRoot string) string {
	return filepath.Join(journalRoot, "snapshots")
}

// CreateSnapshot 把当前完整投影写为内容哈希命名的不可变快照。
func (store *Store) CreateSnapshot(ctx context.Context) (SnapshotInfo, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return SnapshotInfo{}, errors.New("flashcard store is closed")
	}
	root := SnapshotRoot(store.journal.root)
	dir := filepath.Join(root, store.journal.WriterID())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return SnapshotInfo{}, fmt.Errorf("create flashcard snapshot directory: %w", err)
	}
	buildingPath := filepath.Join(dir, ".building-"+uuid.NewString()+".db")
	defer func() { _ = removeProjectionFiles(buildingPath) }()
	if err := store.projection.VacuumInto(ctx, buildingPath); err != nil {
		return SnapshotInfo{}, err
	}
	if err := clearDisposableSnapshotData(ctx, buildingPath); err != nil {
		return SnapshotInfo{}, err
	}
	if ProjectionNeedsRebuild(buildingPath) {
		return SnapshotInfo{}, errors.New("created flashcard snapshot did not pass projection validation")
	}
	hash, err := fileSHA256(buildingPath)
	if err != nil {
		return SnapshotInfo{}, err
	}
	createdAt := store.journal.now().UnixMilli()
	name := fmt.Sprintf("%020d-%s.db", createdAt, hash)
	path := filepath.Join(dir, name)
	if info, statErr := os.Lstat(path); statErr == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return SnapshotInfo{}, errors.New("flashcard snapshot target is not a regular file")
		}
		existingHash, hashErr := fileSHA256(path)
		if hashErr != nil || existingHash != hash {
			return SnapshotInfo{}, errors.New("flashcard snapshot target has conflicting content")
		}
		return inspectSnapshot(path, store.journal.WriterID(), createdAt, hash)
	} else if !os.IsNotExist(statErr) {
		return SnapshotInfo{}, fmt.Errorf("inspect flashcard snapshot target: %w", statErr)
	}
	if err = os.Rename(buildingPath, path); err != nil {
		return SnapshotInfo{}, fmt.Errorf("activate flashcard snapshot: %w", err)
	}
	return inspectSnapshot(path, store.journal.WriterID(), createdAt, hash)
}

func clearDisposableSnapshotData(ctx context.Context, path string) error {
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000")
	if err != nil {
		return fmt.Errorf("open flashcard snapshot for cache cleanup: %w", err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin flashcard snapshot cache cleanup: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	tables := []string{"block_metadata", "block_search_content", "source_availability"}
	if flashcardFTSAvailable {
		tables = append(tables, "block_search_fts")
	}
	for _, table := range tables {
		if _, err = tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return fmt.Errorf("clear disposable flashcard snapshot table [%s]: %w", table, err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard snapshot cache cleanup: %w", err)
	}
	return nil
}

// BestSnapshot 返回批次覆盖最多且校验通过的快照，损坏快照会被忽略。
func BestSnapshot(root string) (SnapshotInfo, bool, error) {
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return SnapshotInfo{}, false, nil
	}
	if err != nil {
		return SnapshotInfo{}, false, fmt.Errorf("inspect flashcard snapshot root: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return SnapshotInfo{}, false, errors.New("flashcard snapshot root is not a regular directory")
	}
	writers, err := os.ReadDir(root)
	if err != nil {
		return SnapshotInfo{}, false, fmt.Errorf("read flashcard snapshot writers: %w", err)
	}
	var candidates []SnapshotInfo
	for _, writer := range writers {
		if writer.Type()&os.ModeSymlink != 0 || !writer.IsDir() {
			continue
		}
		writerID := writer.Name()
		if _, parseErr := uuid.Parse(writerID); parseErr != nil {
			continue
		}
		dir := filepath.Join(root, writerID)
		entries, readErr := os.ReadDir(dir)
		if readErr != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			createdAt, hash, parsed := parseSnapshotName(entry.Name())
			if !parsed {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			candidate, inspectErr := inspectSnapshot(path, writerID, createdAt, hash)
			if inspectErr == nil {
				candidates = append(candidates, candidate)
			}
		}
	}
	if len(candidates) == 0 {
		return SnapshotInfo{}, false, nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].BatchCount != candidates[j].BatchCount {
			return candidates[i].BatchCount > candidates[j].BatchCount
		}
		if candidates[i].CreatedAt != candidates[j].CreatedAt {
			return candidates[i].CreatedAt > candidates[j].CreatedAt
		}
		return candidates[i].Path < candidates[j].Path
	})
	return candidates[0], true, nil
}

func (projection *Projection) VacuumInto(ctx context.Context, path string) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	if strings.TrimSpace(path) == "" || strings.ContainsRune(path, '\x00') {
		return errors.New("flashcard snapshot path is invalid")
	}
	if _, err := os.Lstat(path); err == nil {
		return errors.New("flashcard snapshot path already exists")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect flashcard snapshot path: %w", err)
	}
	escapedPath := strings.ReplaceAll(path, "'", "''")
	if _, err := projection.db.ExecContext(ctx, "VACUUM INTO '"+escapedPath+"'"); err != nil {
		return fmt.Errorf("create flashcard projection snapshot: %w", err)
	}
	return nil
}

func inspectSnapshot(path, writerID string, createdAt int64, expectedHash string) (SnapshotInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return SnapshotInfo{}, err
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return SnapshotInfo{}, errors.New("flashcard snapshot is not a regular file")
	}
	hash, err := fileSHA256(path)
	if err != nil {
		return SnapshotInfo{}, err
	}
	if hash != expectedHash {
		return SnapshotInfo{}, errors.New("flashcard snapshot content hash does not match its name")
	}
	if ProjectionNeedsRebuild(path) {
		return SnapshotInfo{}, errors.New("flashcard snapshot projection is invalid")
	}
	db, err := sql.Open("sqlite3", path+"?mode=ro&_busy_timeout=1000")
	if err != nil {
		return SnapshotInfo{}, err
	}
	defer db.Close()
	var batchCount int64
	if err = db.QueryRow("SELECT COUNT(*) FROM operation_batches").Scan(&batchCount); err != nil {
		return SnapshotInfo{}, err
	}
	return SnapshotInfo{
		Path:       path,
		WriterID:   writerID,
		CreatedAt:  createdAt,
		Hash:       hash,
		BatchCount: batchCount,
	}, nil
}

func snapshotCoveredByBatches(ctx context.Context, path string, batches []OperationBatch) (bool, error) {
	authority := make(map[string]string, len(batches))
	for _, batch := range batches {
		if checksum, found := authority[batch.BatchID]; found && checksum != batch.Checksum {
			return false, ErrProjectionConflict
		}
		authority[batch.BatchID] = batch.Checksum
	}
	db, err := sql.Open("sqlite3", path+"?mode=ro&_busy_timeout=1000")
	if err != nil {
		return false, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, "SELECT batch_id, checksum FROM operation_batches")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var batchID, checksum string
		if err = rows.Scan(&batchID, &checksum); err != nil {
			return false, err
		}
		if authority[batchID] != checksum {
			return false, nil
		}
	}
	if err = rows.Err(); err != nil {
		return false, err
	}
	return true, nil
}

func parseSnapshotName(name string) (createdAt int64, hash string, ok bool) {
	if !strings.HasSuffix(name, ".db") {
		return 0, "", false
	}
	base := strings.TrimSuffix(name, ".db")
	separator := strings.IndexByte(base, '-')
	if separator < 1 {
		return 0, "", false
	}
	createdAt, err := strconv.ParseInt(base[:separator], 10, 64)
	if err != nil || createdAt < 0 {
		return 0, "", false
	}
	hash = base[separator+1:]
	if len(hash) != sha256.Size*2 {
		return 0, "", false
	}
	if _, err = hex.DecodeString(hash); err != nil {
		return 0, "", false
	}
	return createdAt, hash, true
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open flashcard snapshot for hashing: %w", err)
	}
	defer file.Close()
	digest := sha256.New()
	if _, err = io.Copy(digest, file); err != nil {
		return "", fmt.Errorf("hash flashcard snapshot: %w", err)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func copyProjectionFile(source, target string) error {
	if err := removeProjectionFiles(target); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return fmt.Errorf("create flashcard projection directory for snapshot: %w", err)
	}
	sourceFile, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open flashcard snapshot: %w", err)
	}
	defer sourceFile.Close()
	targetFile, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create flashcard projection from snapshot: %w", err)
	}
	copyErr := error(nil)
	if _, err = io.Copy(targetFile, sourceFile); err != nil {
		copyErr = fmt.Errorf("copy flashcard snapshot: %w", err)
	}
	if syncErr := targetFile.Sync(); syncErr != nil {
		copyErr = errors.Join(copyErr, fmt.Errorf("sync copied flashcard snapshot: %w", syncErr))
	}
	if closeErr := targetFile.Close(); closeErr != nil {
		copyErr = errors.Join(copyErr, fmt.Errorf("close copied flashcard snapshot: %w", closeErr))
	}
	if copyErr != nil {
		_ = removeProjectionFiles(target)
	}
	return copyErr
}
