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
	"encoding/json"
	"errors"
	"reflect"
	"sort"
)

// BlockPresence 区分源文件已确认缺失与暂时不可访问；未知值始终阻止清理。
type BlockPresence string

const (
	BlockPresent BlockPresence = "present"
	BlockMissing BlockPresence = "missing"
	BlockClosed  BlockPresence = "closed"
	BlockUnknown BlockPresence = "unknown"
)

type InvalidSource struct {
	SourceID   string        `json:"sourceID"`
	RevisionID string        `json:"revisionID"`
	BlockIDs   []string      `json:"blockIDs"`
	CardCount  int           `json:"cardCount"`
	Reason     BlockPresence `json:"reason"`
}

type InvalidSourcesReport struct {
	Sources []InvalidSource `json:"sources"`
}

type DeleteInvalidSourcesRequest struct {
	OperationID string          `json:"operationID"`
	Sources     []InvalidSource `json:"sources"`
	ChangedAt   int64           `json:"changedAt"`
}

type DeleteInvalidSourcesResult struct {
	Deleted []string `json:"deleted"`
	Skipped []string `json:"skipped"`
}

type ResolveBlockPresence func(context.Context, []string) (map[string]BlockPresence, error)

// InspectInvalidSources 在稳定的卡源视图上核验全部必需引用，不改变生成状态。
func (store *Store) InspectInvalidSources(ctx context.Context, resolve ResolveBlockPresence) (InvalidSourcesReport, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.inspectInvalidSourcesLocked(ctx, resolve)
}

func (store *Store) inspectInvalidSourcesLocked(ctx context.Context, resolve ResolveBlockPresence) (InvalidSourcesReport, error) {
	ret := InvalidSourcesReport{Sources: []InvalidSource{}}
	if store.closed {
		return ret, errors.New("flashcard store is closed")
	}
	dependencies, err := store.projection.SourceBlockDependencies(ctx)
	if err != nil {
		return ret, err
	}
	ids := map[string]struct{}{}
	for _, dependency := range dependencies {
		for _, id := range dependency.BlockIDs {
			ids[id] = struct{}{}
		}
	}
	blockIDs := make([]string, 0, len(ids))
	for id := range ids {
		blockIDs = append(blockIDs, id)
	}
	sort.Strings(blockIDs)
	presence, err := resolve(ctx, blockIDs)
	if err != nil {
		return ret, err
	}
	for _, dependency := range dependencies {
		reason := BlockPresent
		for _, id := range dependency.BlockIDs {
			switch presence[id] {
			case BlockPresent:
			case BlockMissing:
				if reason == BlockPresent {
					reason = BlockMissing
				}
			case BlockClosed:
				if reason != BlockUnknown {
					reason = BlockClosed
				}
			default:
				reason = BlockUnknown
			}
		}
		if reason == BlockPresent {
			continue
		}
		revision, found, readErr := store.projection.CurrentEntity(ctx, EntityCardSource, dependency.SourceID)
		if readErr != nil {
			return ret, readErr
		}
		if !found || revision.Deleted {
			continue
		}
		var conflicts int
		if err = store.projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM entity_conflicts
			WHERE resolved = 0 AND ((entity_type = ? AND entity_id = ?) OR
			(entity_type = ? AND entity_id IN (SELECT id FROM card_source_refs WHERE source_id = ?)))`,
			EntityCardSource, dependency.SourceID, EntityCardSourceRef, dependency.SourceID).Scan(&conflicts); err != nil {
			return ret, err
		}
		if conflicts > 0 {
			reason = BlockUnknown
		}
		var count int
		if err = store.projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM cards c
			JOIN entities e ON e.entity_type = ? AND e.entity_id = c.id AND e.deleted = 0
			WHERE c.source_id = ?`, EntityCard, dependency.SourceID).Scan(&count); err != nil {
			return ret, err
		}
		if count == 0 {
			continue
		}
		ret.Sources = append(ret.Sources, InvalidSource{SourceID: dependency.SourceID, RevisionID: revision.RevisionID,
			BlockIDs: dependency.BlockIDs, CardCount: count, Reason: reason})
	}
	return ret, nil
}

// DeleteInvalidSources 重新核验选中卡源后，在一个日志操作中软删除，保留排期和历史。
func (store *Store) DeleteInvalidSources(ctx context.Context, request DeleteInvalidSourcesRequest,
	resolve ResolveBlockPresence) (DeleteInvalidSourcesResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	ret := DeleteInvalidSourcesResult{Deleted: []string{}, Skipped: []string{}}
	if store.closed || request.OperationID == "" || request.ChangedAt <= 0 || len(request.Sources) == 0 {
		return ret, errors.New("invalid flashcard cleanup request")
	}
	// 从已写入日志恢复重试结果，不重复删除，也不受源文件后续变化影响。
	if batch, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return ret, err
	} else if found {
		selected := map[string]InvalidSource{}
		for _, source := range request.Sources {
			selected[source.SourceID] = source
		}
		for _, change := range batch.Changes {
			if change.Kind != RecordEntityRevision || change.Revision == nil || change.Revision.EntityType != EntityCardSource {
				return ret, ErrOperationConflict
			}
			revision := change.Revision
			source, ok := selected[revision.EntityID]
			var payload CardSource
			if !ok || len(revision.ParentRevisionIDs) != 1 || revision.ParentRevisionIDs[0] != source.RevisionID ||
				json.Unmarshal(revision.Payload, &payload) != nil || payload.Status != "deleted" {
				return ret, ErrOperationConflict
			}
			ret.Deleted = append(ret.Deleted, revision.EntityID)
			delete(selected, revision.EntityID)
		}
		for id := range selected {
			ret.Skipped = append(ret.Skipped, id)
		}
		sort.Strings(ret.Skipped)
		return ret, nil
	}
	report, err := store.inspectInvalidSourcesLocked(ctx, resolve)
	if err != nil {
		return ret, err
	}
	candidates := map[string]InvalidSource{}
	for _, source := range report.Sources {
		candidates[source.SourceID] = source
	}
	seen := map[string]bool{}
	var changes []Change
	for _, selected := range request.Sources {
		if seen[selected.SourceID] {
			continue
		}
		seen[selected.SourceID] = true
		candidate, found := candidates[selected.SourceID]
		if !found || candidate.Reason != BlockMissing || selected.RevisionID == "" || candidate.RevisionID != selected.RevisionID ||
			candidate.CardCount != selected.CardCount || !reflect.DeepEqual(candidate.BlockIDs, selected.BlockIDs) {
			ret.Skipped = append(ret.Skipped, selected.SourceID)
			continue
		}
		current, _, readErr := store.projection.CurrentEntity(ctx, EntityCardSource, selected.SourceID)
		if readErr != nil {
			return ret, readErr
		}
		var source CardSource
		if err = json.Unmarshal(current.Payload, &source); err != nil {
			return ret, err
		}
		source.Status = "deleted"
		revision, revisionErr := NewOperationEntityRevision(request.OperationID, EntityCardSource, source.ID,
			[]string{current.RevisionID}, request.ChangedAt, false, source)
		if revisionErr != nil {
			return ret, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
		ret.Deleted = append(ret.Deleted, source.ID)
	}
	if len(changes) == 0 {
		return ret, nil
	}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return ret, err
	}
	_, err = store.applyLocked(ctx, request.OperationID, changes)
	return ret, err
}
