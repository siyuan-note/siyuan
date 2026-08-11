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
	"fmt"
	"sort"
	"strings"
)

const maxTagAssignmentTargets = 10000

// SetTagAssignmentsRequest 将一个或多个目标的标签原子替换为相同的最终集合。
type SetTagAssignmentsRequest struct {
	OperationID string   `json:"operationID"`
	TargetType  string   `json:"targetType"`
	TargetIDs   []string `json:"targetIDs"`
	TagIDs      []string `json:"tagIDs"`
	ChangedAt   int64    `json:"changedAt"`
}

// SetTagAssignmentsResult 返回原子批次和每个目标的最终标签集合。
type SetTagAssignmentsResult struct {
	Batch       OperationBatch      `json:"batch"`
	Assignments map[string][]string `json:"assignments"`
}

type currentTagAssignment struct {
	revision   EntityRevision
	assignment TagAssignment
}

// SetTagAssignments 使用独立关系实体原子替换卡源或卡片标签，避免覆盖其他目标的并发修改。
func (store *Store) SetTagAssignments(ctx context.Context,
	request SetTagAssignmentsRequest) (SetTagAssignmentsResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return SetTagAssignmentsResult{}, errors.New("flashcard store is closed")
	}
	normalized, err := request.normalized()
	if err != nil {
		return SetTagAssignmentsResult{}, err
	}
	if existing, found := store.journal.FindOperation(normalized.OperationID); found {
		return tagAssignmentsResultFromBatch(existing, normalized)
	}
	if err = store.validateTagAssignmentTargets(ctx, normalized); err != nil {
		return SetTagAssignmentsResult{}, err
	}
	desired := stringSet(normalized.TagIDs)
	changes := make([]Change, 0, len(normalized.TargetIDs)*(len(normalized.TagIDs)+1)+1)
	for _, targetID := range normalized.TargetIDs {
		current, queryErr := store.projection.tagAssignmentsForTarget(ctx, normalized.TargetType, targetID)
		if queryErr != nil {
			return SetTagAssignmentsResult{}, queryErr
		}
		currentByTag := make(map[string]currentTagAssignment, len(current))
		for _, item := range current {
			currentByTag[item.assignment.TagID] = item
			if _, keep := desired[item.assignment.TagID]; keep {
				continue
			}
			revision, revisionErr := NewOperationEntityRevision(normalized.OperationID, EntityTagAssignment,
				item.assignment.ID, []string{item.revision.RevisionID}, normalized.ChangedAt, true, struct{}{})
			if revisionErr != nil {
				return SetTagAssignmentsResult{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
		}
		for _, tagID := range normalized.TagIDs {
			if _, found := currentByTag[tagID]; found {
				continue
			}
			assignmentID := DeterministicID("tag-assignment", tagID, normalized.TargetType, targetID)
			parents := []string(nil)
			previous, found, currentErr := store.projection.CurrentEntity(ctx, EntityTagAssignment, assignmentID)
			if currentErr != nil {
				return SetTagAssignmentsResult{}, currentErr
			}
			if found {
				if !previous.Deleted {
					return SetTagAssignmentsResult{}, fmt.Errorf("flashcard tag assignment [%s] already exists",
						assignmentID)
				}
				parents = []string{previous.RevisionID}
			}
			assignment := TagAssignment{
				ID: assignmentID, TagID: tagID, TargetType: normalized.TargetType, TargetID: targetID,
			}
			revision, revisionErr := NewOperationEntityRevision(normalized.OperationID, EntityTagAssignment,
				assignmentID, parents, normalized.ChangedAt, false, assignment)
			if revisionErr != nil {
				return SetTagAssignmentsResult{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
		}
	}
	payload := TagAssignmentsChangedEventPayload{
		TargetType: normalized.TargetType, TargetIDs: normalized.TargetIDs, TagIDs: normalized.TagIDs,
		ChangedAt: normalized.ChangedAt,
	}
	payloadJSON, err := CanonicalJSON(payload)
	if err != nil {
		return SetTagAssignmentsResult{}, err
	}
	event := Event{
		EventType:  EventTagAssignmentsChanged,
		EventID:    DeterministicID("tag-assignments-event", normalized.OperationID),
		OccurredAt: normalized.ChangedAt, Payload: payloadJSON,
	}
	if err = event.Validate(); err != nil {
		return SetTagAssignmentsResult{}, err
	}
	changes = append(changes, Change{Kind: RecordEvent, Event: &event})
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return SetTagAssignmentsResult{}, err
	}
	batch, err := store.applyLocked(ctx, normalized.OperationID, changes)
	if err != nil {
		return SetTagAssignmentsResult{}, err
	}
	return tagAssignmentsResultFromBatch(batch, normalized)
}

func (request SetTagAssignmentsRequest) normalized() (SetTagAssignmentsRequest, error) {
	request.OperationID = strings.TrimSpace(request.OperationID)
	request.TargetType = strings.TrimSpace(request.TargetType)
	if request.OperationID == "" || request.ChangedAt <= 0 ||
		(request.TargetType != "source" && request.TargetType != "card") || len(request.TargetIDs) == 0 ||
		len(request.TargetIDs) > maxTagAssignmentTargets {
		return SetTagAssignmentsRequest{}, errors.New("flashcard tag assignment request is invalid")
	}
	var err error
	if request.TargetIDs, err = normalizedUniqueIDs(request.TargetIDs, "flashcard tag target"); err != nil {
		return SetTagAssignmentsRequest{}, err
	}
	if request.TagIDs, err = normalizedUniqueIDs(request.TagIDs, "flashcard tag"); err != nil {
		return SetTagAssignmentsRequest{}, err
	}
	return request, nil
}

func normalizedUniqueIDs(values []string, name string) ([]string, error) {
	ret := make([]string, len(values))
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("%s ID is required", name)
		}
		if _, duplicate := seen[value]; duplicate {
			return nil, fmt.Errorf("duplicate %s [%s]", name, value)
		}
		seen[value] = struct{}{}
		ret[index] = value
	}
	sort.Strings(ret)
	return ret, nil
}

func (store *Store) validateTagAssignmentTargets(ctx context.Context, request SetTagAssignmentsRequest) error {
	entityType := EntityCardSource
	if request.TargetType == "card" {
		entityType = EntityCard
	}
	for _, targetID := range request.TargetIDs {
		revision, found, err := store.projection.CurrentEntity(ctx, entityType, targetID)
		if err != nil {
			return err
		}
		if !found || revision.Deleted {
			return fmt.Errorf("%w: %s [%s]", ErrEntityNotFound, request.TargetType, targetID)
		}
		if request.TargetType == "card" {
			conflicted, conflictErr := store.projection.CardHasUnresolvedConflict(ctx, targetID)
			if conflictErr != nil {
				return conflictErr
			}
			if conflicted {
				return fmt.Errorf("flashcard [%s] has an unresolved entity conflict", targetID)
			}
		}
	}
	for _, tagID := range request.TagIDs {
		revision, found, err := store.projection.CurrentEntity(ctx, EntityTag, tagID)
		if err != nil {
			return err
		}
		if !found || revision.Deleted {
			return fmt.Errorf("%w: tag [%s]", ErrEntityNotFound, tagID)
		}
	}
	return nil
}

func (projection *Projection) tagAssignmentsForTarget(ctx context.Context, targetType,
	targetID string) ([]currentTagAssignment, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id, e.updated_at, e.payload
		FROM tag_assignments a JOIN entities e ON e.entity_type = ? AND e.entity_id = a.id AND e.deleted = 0
		WHERE a.target_type = ? AND a.target_id = ? ORDER BY a.tag_id, a.id`, EntityTagAssignment,
		targetType, targetID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard tag assignments: %w", err)
	}
	defer rows.Close()
	var ret []currentTagAssignment
	for rows.Next() {
		var item currentTagAssignment
		var payload []byte
		if err = rows.Scan(&item.revision.EntityID, &item.revision.RevisionID, &item.revision.UpdatedAt,
			&payload); err != nil {
			return nil, fmt.Errorf("scan flashcard tag assignment: %w", err)
		}
		item.revision.EntityType = EntityTagAssignment
		item.revision.Payload = json.RawMessage(payload)
		if err = decodeStrictJSON(payload, &item.assignment); err != nil {
			return nil, err
		}
		ret = append(ret, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard tag assignments: %w", err)
	}
	return ret, nil
}

func tagAssignmentsResultFromBatch(batch OperationBatch,
	request SetTagAssignmentsRequest) (SetTagAssignmentsResult, error) {
	eventFound := false
	for _, change := range batch.Changes {
		if change.Kind == RecordEntityRevision {
			if change.Revision == nil || change.Revision.EntityType != EntityTagAssignment ||
				change.Revision.UpdatedAt != request.ChangedAt {
				return SetTagAssignmentsResult{}, ErrOperationConflict
			}
			continue
		}
		if change.Kind != RecordEvent || change.Event == nil || eventFound ||
			change.Event.EventType != EventTagAssignmentsChanged || change.Event.OccurredAt != request.ChangedAt {
			return SetTagAssignmentsResult{}, ErrOperationConflict
		}
		var payload TagAssignmentsChangedEventPayload
		if err := decodeStrictJSON(change.Event.Payload, &payload); err != nil ||
			payload.TargetType != request.TargetType || payload.ChangedAt != request.ChangedAt ||
			!equalStrings(payload.TargetIDs, request.TargetIDs) || !equalStrings(payload.TagIDs, request.TagIDs) {
			return SetTagAssignmentsResult{}, ErrOperationConflict
		}
		eventFound = true
	}
	if !eventFound {
		return SetTagAssignmentsResult{}, ErrOperationConflict
	}
	assignments := make(map[string][]string, len(request.TargetIDs))
	for _, targetID := range request.TargetIDs {
		assignments[targetID] = append([]string(nil), request.TagIDs...)
	}
	return SetTagAssignmentsResult{Batch: batch, Assignments: assignments}, nil
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
