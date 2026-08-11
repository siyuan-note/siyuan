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
	"strings"
)

// BlockMetadata 是可从块树重建的卡源位置投影，不属于权威闪卡记录。
type BlockMetadata struct {
	BlockID    string `json:"blockID"`
	NotebookID string `json:"notebookID"`
	RootID     string `json:"rootID"`
	Path       string `json:"path"`
	HPath      string `json:"hPath"`
}

// SourceBlockDependency 汇总一个卡源必须持续存在的普通块引用。
type SourceBlockDependency struct {
	SourceID string   `json:"sourceID"`
	BlockIDs []string `json:"blockIDs"`
}

func validateBlockMetadata(values []BlockMetadata) error {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if strings.TrimSpace(value.BlockID) == "" || strings.TrimSpace(value.NotebookID) == "" ||
			strings.TrimSpace(value.RootID) == "" || strings.TrimSpace(value.Path) == "" {
			return errors.New("flashcard block metadata is incomplete")
		}
		if _, found := seen[value.BlockID]; found {
			return fmt.Errorf("duplicate flashcard block metadata [%s]", value.BlockID)
		}
		seen[value.BlockID] = struct{}{}
	}
	return nil
}

// RequiredBlockMetadataIDs 返回当前卡源主引用需要的位置元数据块 ID。
func (projection *Projection) RequiredBlockMetadataIDs(ctx context.Context) ([]string, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT DISTINCT ref.entity_id
		FROM card_sources source
		JOIN card_source_refs ref ON ref.id = source.primary_ref_id
		WHERE ref.entity_type = 'block'
		ORDER BY ref.entity_id`)
	if err != nil {
		return nil, fmt.Errorf("query required flashcard block metadata: %w", err)
	}
	defer rows.Close()
	var ret []string
	for rows.Next() {
		var blockID string
		if err = rows.Scan(&blockID); err != nil {
			return nil, fmt.Errorf("scan required flashcard block metadata: %w", err)
		}
		ret = append(ret, blockID)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate required flashcard block metadata: %w", err)
	}
	return ret, nil
}

// SourceBlockDependencies 返回活动或孤立卡源的主引用和必需普通块引用。
func (projection *Projection) SourceBlockDependencies(ctx context.Context) ([]SourceBlockDependency, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT source.id, ref.entity_id
		FROM card_sources source
		JOIN card_source_refs ref ON ref.source_id = source.id AND ref.entity_type = 'block'
			AND (ref.required = 1 OR ref.id = source.primary_ref_id)
		WHERE source.status IN ('active', 'orphaned')
		ORDER BY source.id, ref.entity_id`)
	if err != nil {
		return nil, fmt.Errorf("query flashcard source block dependencies: %w", err)
	}
	defer rows.Close()
	var ret []SourceBlockDependency
	for rows.Next() {
		var sourceID, blockID string
		if err = rows.Scan(&sourceID, &blockID); err != nil {
			return nil, fmt.Errorf("scan flashcard source block dependency: %w", err)
		}
		if len(ret) == 0 || ret[len(ret)-1].SourceID != sourceID {
			ret = append(ret, SourceBlockDependency{SourceID: sourceID})
		}
		ret[len(ret)-1].BlockIDs = append(ret[len(ret)-1].BlockIDs, blockID)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard source block dependencies: %w", err)
	}
	return ret, nil
}

// ReplaceBlockMetadata 原子替换可删除的位置缓存；缺失块不会保留过期位置。
func (projection *Projection) ReplaceBlockMetadata(ctx context.Context, values []BlockMetadata) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	if err := validateBlockMetadata(values); err != nil {
		return err
	}
	tx, err := projection.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin flashcard block metadata transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "DELETE FROM block_metadata"); err != nil {
		return fmt.Errorf("clear flashcard block metadata: %w", err)
	}
	for _, value := range values {
		if _, err = tx.ExecContext(ctx, `INSERT INTO block_metadata
			(block_id, notebook_id, root_id, path, h_path) VALUES (?, ?, ?, ?, ?)`, value.BlockID,
			value.NotebookID, value.RootID, value.Path, value.HPath); err != nil {
			return fmt.Errorf("insert flashcard block metadata [%s]: %w", value.BlockID, err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard block metadata: %w", err)
	}
	return nil
}

// ReplaceBlockMetadataAndSourceAvailability 在同一事务中切换位置与可用性缓存。
func (projection *Projection) ReplaceBlockMetadataAndSourceAvailability(ctx context.Context,
	metadata []BlockMetadata, availability map[string]bool) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	if err := validateBlockMetadata(metadata); err != nil {
		return err
	}
	for sourceID := range availability {
		if strings.TrimSpace(sourceID) == "" {
			return errors.New("flashcard source availability identity is incomplete")
		}
	}
	tx, err := projection.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin flashcard location cache transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "DELETE FROM block_metadata"); err != nil {
		return fmt.Errorf("clear flashcard block metadata: %w", err)
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM source_availability"); err != nil {
		return fmt.Errorf("clear flashcard source availability: %w", err)
	}
	for _, value := range metadata {
		if _, err = tx.ExecContext(ctx, `INSERT INTO block_metadata
			(block_id, notebook_id, root_id, path, h_path) VALUES (?, ?, ?, ?, ?)`, value.BlockID,
			value.NotebookID, value.RootID, value.Path, value.HPath); err != nil {
			return fmt.Errorf("insert flashcard block metadata [%s]: %w", value.BlockID, err)
		}
	}
	for sourceID, available := range availability {
		if _, err = tx.ExecContext(ctx, `INSERT INTO source_availability(source_id, available) VALUES (?, ?)`,
			sourceID, available); err != nil {
			return fmt.Errorf("insert flashcard source availability [%s]: %w", sourceID, err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard location cache: %w", err)
	}
	return nil
}

// ReplaceSourceAvailability 原子替换从必需块引用计算出的卡源可用性缓存。
func (projection *Projection) ReplaceSourceAvailability(ctx context.Context,
	values map[string]bool) error {
	projection.mu.Lock()
	defer projection.mu.Unlock()
	if projection.closed {
		return errors.New("flashcard projection is closed")
	}
	tx, err := projection.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin flashcard source availability transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "DELETE FROM source_availability"); err != nil {
		return fmt.Errorf("clear flashcard source availability: %w", err)
	}
	for sourceID, available := range values {
		if strings.TrimSpace(sourceID) == "" {
			return errors.New("flashcard source availability identity is incomplete")
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO source_availability(source_id, available) VALUES (?, ?)`,
			sourceID, available); err != nil {
			return fmt.Errorf("insert flashcard source availability [%s]: %w", sourceID, err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit flashcard source availability: %w", err)
	}
	return nil
}
