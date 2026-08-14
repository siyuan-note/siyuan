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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// EntityConflictGroup 返回同一实体的全部未解决分支和当前确定性选择。
type EntityConflictGroup struct {
	EntityType         EntityType       `json:"entityType"`
	EntityID           string           `json:"entityID"`
	SelectedRevisionID string           `json:"selectedRevisionID"`
	DetectedAt         int64            `json:"detectedAt"`
	Revisions          []EntityRevision `json:"revisions"`
}

// ConflictResolutionRequest 描述用户选择一个分支并生成合并修订的操作。
type ConflictResolutionRequest struct {
	OperationID      string                     `json:"operationID"`
	EntityType       EntityType                 `json:"entityType"`
	EntityID         string                     `json:"entityID"`
	SelectedRevision string                     `json:"selectedRevisionID"`
	ResolvedAt       int64                      `json:"resolvedAt"`
	ValidateSelected func(EntityRevision) error `json:"-"`
}

// ListEntityConflicts 返回尚未被合并修订覆盖的版本化实体冲突。
func (projection *Projection) ListEntityConflicts(ctx context.Context, limit int) ([]EntityConflictGroup, error) {
	if limit <= 0 || limit > 1000 {
		return nil, errors.New("flashcard conflict limit is invalid")
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT entity_type, entity_id, selected_revision_id,
		MAX(detected_at) FROM entity_conflicts WHERE resolved = 0
		GROUP BY entity_type, entity_id, selected_revision_id ORDER BY MAX(detected_at), entity_type, entity_id LIMIT ?`,
		limit)
	if err != nil {
		return nil, fmt.Errorf("query flashcard entity conflicts: %w", err)
	}
	defer rows.Close()
	groups := make([]EntityConflictGroup, 0)
	for rows.Next() {
		var group EntityConflictGroup
		if err = rows.Scan(&group.EntityType, &group.EntityID, &group.SelectedRevisionID,
			&group.DetectedAt); err != nil {
			return nil, fmt.Errorf("scan flashcard entity conflict: %w", err)
		}
		groups = append(groups, group)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard entity conflicts: %w", err)
	}
	for index := range groups {
		revisionIDs, queryErr := projection.conflictRevisionIDs(ctx, groups[index].EntityType,
			groups[index].EntityID)
		if queryErr != nil {
			return nil, queryErr
		}
		groups[index].Revisions = make([]EntityRevision, 0, len(revisionIDs))
		for _, revisionID := range revisionIDs {
			revision, found, revisionErr := projection.entityRevisionByID(ctx, revisionID)
			if revisionErr != nil {
				return nil, revisionErr
			}
			if !found {
				return nil, fmt.Errorf("flashcard conflict revision [%s] was not found", revisionID)
			}
			groups[index].Revisions = append(groups[index].Revisions, revision)
		}
	}
	return groups, nil
}

// ResolveEntityConflict 生成包含全部冲突父修订的合并修订，所选分支决定实体内容。
func (store *Store) ResolveEntityConflict(ctx context.Context,
	request ConflictResolutionRequest) (EntityRevision, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return EntityRevision{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(string(request.EntityType)) == "" ||
		strings.TrimSpace(request.EntityID) == "" || strings.TrimSpace(request.SelectedRevision) == "" ||
		request.ResolvedAt <= 0 {
		return EntityRevision{}, errors.New("flashcard conflict resolution request is invalid")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return EntityRevision{}, err
	} else if found {
		return store.conflictResolutionFromBatch(ctx, existing, request)
	}
	revisionIDs, err := store.projection.conflictRevisionIDs(ctx, request.EntityType, request.EntityID)
	if err != nil {
		return EntityRevision{}, err
	}
	if len(revisionIDs) < 2 {
		return EntityRevision{}, errors.New("flashcard entity has no unresolved conflict")
	}
	sort.Strings(revisionIDs)
	selectedFound := false
	var selected EntityRevision
	for _, revisionID := range revisionIDs {
		if revisionID != request.SelectedRevision {
			continue
		}
		selectedFound = true
		selected, _, err = store.projection.entityRevisionByID(ctx, revisionID)
		if err != nil {
			return EntityRevision{}, err
		}
		break
	}
	if !selectedFound {
		return EntityRevision{}, errors.New("selected flashcard conflict revision is not an unresolved branch")
	}
	if request.ValidateSelected != nil {
		if err = request.ValidateSelected(selected); err != nil {
			return EntityRevision{}, err
		}
	}
	payload, err := conflictResolutionPayload(request.OperationID, selected)
	if err != nil {
		return EntityRevision{}, err
	}
	merge, err := NewOperationEntityRevision(request.OperationID, request.EntityType, request.EntityID,
		revisionIDs, request.ResolvedAt, selected.Deleted, payload)
	if err != nil {
		return EntityRevision{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &merge}}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return EntityRevision{}, err
	}
	if _, err = store.applyLocked(ctx, request.OperationID, changes); err != nil {
		return EntityRevision{}, err
	}
	return merge, nil
}

func (store *Store) conflictResolutionFromBatch(ctx context.Context, batch OperationBatch,
	request ConflictResolutionRequest) (EntityRevision, error) {
	if len(batch.Changes) != 1 || batch.Changes[0].Kind != RecordEntityRevision ||
		batch.Changes[0].Revision == nil {
		return EntityRevision{}, ErrOperationConflict
	}
	revision := *batch.Changes[0].Revision
	if revision.EntityType != request.EntityType || revision.EntityID != request.EntityID ||
		revision.UpdatedAt != request.ResolvedAt {
		return EntityRevision{}, ErrOperationConflict
	}
	selected := false
	for _, parentID := range revision.ParentRevisionIDs {
		if parentID == request.SelectedRevision {
			selected = true
			break
		}
	}
	if !selected {
		return EntityRevision{}, ErrOperationConflict
	}
	selectedRevision, found, err := store.projection.entityRevisionByID(ctx, request.SelectedRevision)
	if err != nil || !found || selectedRevision.EntityType != request.EntityType ||
		selectedRevision.EntityID != request.EntityID || selectedRevision.Deleted != revision.Deleted {
		return EntityRevision{}, ErrOperationConflict
	}
	expectedPayload, err := conflictResolutionPayload(request.OperationID, selectedRevision)
	if err != nil || !bytes.Equal(expectedPayload, revision.Payload) {
		return EntityRevision{}, ErrOperationConflict
	}
	return revision, nil
}

func conflictResolutionPayload(operationID string, selected EntityRevision) (json.RawMessage, error) {
	if selected.Deleted || selected.EntityType != EntityReviewState {
		return append(json.RawMessage(nil), selected.Payload...), nil
	}
	var state ReviewState
	if err := decodeStrictJSON(selected.Payload, &state); err != nil {
		return nil, err
	}
	state.StateRevisionID = OperationRevisionID(operationID, selected.EntityType, selected.EntityID)
	return CanonicalJSON(state)
}
