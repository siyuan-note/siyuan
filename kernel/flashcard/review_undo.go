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
	"sort"
	"strings"
)

// ReviewUndoRequest 指定要撤销的复习事件，CardID 用于校验调用范围。
type ReviewUndoRequest struct {
	OperationID   string `json:"operationID"`
	ReviewEventID string `json:"reviewEventID"`
	CardID        string `json:"cardID"`
	UndoneAt      int64  `json:"undoneAt"`
}

// ReviewUndoResult 返回补偿事件和撤销后恢复的会话及排期状态。
type ReviewUndoResult struct {
	Batch                  OperationBatch       `json:"batch"`
	Event                  Event                `json:"event"`
	ReviewEventID          string               `json:"reviewEventID"`
	CardID                 string               `json:"cardID"`
	RestoredState          *ReviewStateSnapshot `json:"restoredState,omitempty"`
	RestoredSiblingIDs     []string             `json:"restoredSiblingIDs"`
	RestoredSessionCardIDs []string             `json:"restoredSessionCardIDs"`
	SessionCard            *SessionCard         `json:"sessionCard,omitempty"`
	LeechTagRemoved        bool                 `json:"leechTagRemoved"`
}

// UndoReview 以补偿修订撤销一次评分，同时保留原复习事件供审计和同步。
func (store *Store) UndoReview(ctx context.Context, request ReviewUndoRequest) (ReviewUndoResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReviewUndoResult{}, errors.New("flashcard store is closed")
	}
	if err := request.validate(); err != nil {
		return ReviewUndoResult{}, err
	}
	if batch, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return ReviewUndoResult{}, err
	} else if found {
		return reviewUndoResultFromBatch(batch, request)
	}
	targetEvent, targetPayload, batchID, found, err := store.projection.reviewEventByID(ctx,
		request.ReviewEventID)
	if err != nil {
		return ReviewUndoResult{}, err
	}
	if !found {
		return ReviewUndoResult{}, errors.New("flashcard review event was not found")
	}
	if targetPayload.CardID != request.CardID {
		return ReviewUndoResult{}, errors.New("flashcard review event does not belong to the requested card")
	}
	if targetPayload.BaseStateRevisionID == "" || targetPayload.BeforeState == nil {
		return ReviewUndoResult{}, errors.New("imported flashcard review history cannot be undone")
	}
	if request.UndoneAt < targetEvent.OccurredAt {
		return ReviewUndoResult{}, errors.New("flashcard review undo time precedes the review")
	}
	undone, err := store.projection.undoneReviewEventIDs(ctx, request.CardID)
	if err != nil {
		return ReviewUndoResult{}, err
	}
	if _, found = undone[request.ReviewEventID]; found {
		return ReviewUndoResult{}, errors.New("flashcard review event was already undone")
	}
	targetRevisions, err := store.projection.entityRevisionsForBatch(ctx, batchID)
	if err != nil {
		return ReviewUndoResult{}, err
	}
	changes := make([]Change, 0, len(targetRevisions)+1)
	revertedRevisionIDs := make([]string, 0, len(targetRevisions))
	affectedCardIDs := map[string]struct{}{request.CardID: {}}
	for _, target := range targetRevisions {
		if target.EntityType == EntityReviewState {
			affectedCardIDs[target.EntityID] = struct{}{}
		}
	}
	result := ReviewUndoResult{ReviewEventID: request.ReviewEventID, CardID: request.CardID}
	mainStateFound := false
	for _, target := range targetRevisions {
		if target.EntityType == EntityTag {
			// 内置遗忘标签可被其他卡片共用，撤销评分时只移除本次新建的分配关系。
			continue
		}
		if target.EntityType != EntityReviewState && target.EntityType != EntitySessionCard &&
			target.EntityType != EntityTagAssignment {
			return ReviewUndoResult{}, fmt.Errorf("review operation contains unsupported entity [%s]", target.EntityType)
		}
		current, currentFound, currentErr := store.projection.CurrentEntity(ctx, target.EntityType, target.EntityID)
		if currentErr != nil {
			return ReviewUndoResult{}, currentErr
		}
		if !currentFound || current.RevisionID != target.RevisionID {
			return ReviewUndoResult{}, fmt.Errorf("flashcard entity [%s] changed after the review", target.EntityID)
		}
		conflicted, conflictErr := store.projection.entityHasUnresolvedConflict(ctx, target.EntityType,
			target.EntityID)
		if conflictErr != nil {
			return ReviewUndoResult{}, conflictErr
		}
		if conflicted {
			return ReviewUndoResult{}, fmt.Errorf("flashcard entity [%s] has an unresolved conflict", target.EntityID)
		}
		restored, restoreErr := store.restoreReviewRevision(ctx, request, target, targetPayload, affectedCardIDs)
		if restoreErr != nil {
			return ReviewUndoResult{}, restoreErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &restored})
		revertedRevisionIDs = append(revertedRevisionIDs, target.RevisionID)
		switch target.EntityType {
		case EntityReviewState:
			var state ReviewState
			if restoreErr = decodeStrictJSON(restored.Payload, &state); restoreErr != nil {
				return ReviewUndoResult{}, restoreErr
			}
			if target.EntityID == request.CardID {
				mainStateFound = true
				stateSnapshot := state.ReviewStateSnapshot
				result.RestoredState = &stateSnapshot
			} else {
				result.RestoredSiblingIDs = append(result.RestoredSiblingIDs, target.EntityID)
			}
		case EntitySessionCard:
			var sessionCard SessionCard
			if restoreErr = decodeStrictJSON(restored.Payload, &sessionCard); restoreErr != nil {
				return ReviewUndoResult{}, restoreErr
			}
			if sessionCard.CardID == request.CardID {
				result.SessionCard = &sessionCard
			} else {
				result.RestoredSessionCardIDs = append(result.RestoredSessionCardIDs, sessionCard.CardID)
			}
		case EntityTagAssignment:
			result.LeechTagRemoved = restored.Deleted
		}
	}
	if targetPayload.ReviewMode == "normal" && (!mainStateFound || targetPayload.AfterState == nil) {
		return ReviewUndoResult{}, errors.New("normal flashcard review has no reversible state revision")
	}
	sort.Strings(revertedRevisionIDs)
	sort.Strings(result.RestoredSiblingIDs)
	sort.Strings(result.RestoredSessionCardIDs)
	undoPayload := ReviewUndoneEventPayload{
		ReviewEventID: request.ReviewEventID, CardID: request.CardID, UndoneAt: request.UndoneAt,
		RevertedRevisionIDs: revertedRevisionIDs,
	}
	undoEvent, err := NewReviewUndoEvent(request.OperationID, undoPayload)
	if err != nil {
		return ReviewUndoResult{}, err
	}
	changes = append(changes, Change{Kind: RecordEvent, Event: &undoEvent})
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return ReviewUndoResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return ReviewUndoResult{}, err
	}
	result.Batch = batch
	result.Event = undoEvent
	return result, nil
}

func (store *Store) restoreReviewRevision(ctx context.Context, request ReviewUndoRequest, target EntityRevision,
	targetPayload ReviewEventPayload, affectedCardIDs map[string]struct{}) (EntityRevision, error) {
	if len(target.ParentRevisionIDs) > 1 {
		return EntityRevision{}, fmt.Errorf("review entity [%s] has ambiguous parent revisions", target.EntityID)
	}
	deleted := len(target.ParentRevisionIDs) == 0
	var payload any = map[string]any{}
	if !deleted {
		parent, found, err := store.projection.entityRevisionByID(ctx, target.ParentRevisionIDs[0])
		if err != nil {
			return EntityRevision{}, err
		}
		if !found || parent.EntityType != target.EntityType || parent.EntityID != target.EntityID {
			return EntityRevision{}, errors.New("flashcard review parent revision was not found")
		}
		deleted = parent.Deleted
		if !deleted {
			payload = parent.Payload
		}
	}
	if target.EntityType == EntityReviewState {
		if deleted {
			return EntityRevision{}, errors.New("flashcard review state cannot be restored as deleted")
		}
		var state ReviewState
		if err := decodeStrictJSON(payload.(json.RawMessage), &state); err != nil {
			return EntityRevision{}, err
		}
		if target.EntityID == request.CardID {
			if len(target.ParentRevisionIDs) != 1 || target.ParentRevisionIDs[0] != targetPayload.BaseStateRevisionID ||
				targetPayload.AfterState == nil || targetPayload.AfterState.StateRevisionID != target.RevisionID {
				return EntityRevision{}, errors.New("flashcard review state does not match the review event")
			}
		}
		state.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, target.EntityID)
		payload = state
	}
	if target.EntityType == EntitySessionCard && !deleted {
		var sessionCard SessionCard
		if err := decodeStrictJSON(payload.(json.RawMessage), &sessionCard); err != nil {
			return EntityRevision{}, err
		}
		if _, found := affectedCardIDs[sessionCard.CardID]; !found || sessionCard.SessionID != targetPayload.SessionID {
			return EntityRevision{}, errors.New("flashcard session state does not match the review event")
		}
	}
	if target.EntityType == EntityTagAssignment {
		var assignment TagAssignment
		if err := decodeStrictJSON(target.Payload, &assignment); err != nil {
			return EntityRevision{}, err
		}
		if assignment.TagID != builtinLeechTagID || assignment.TargetType != "card" ||
			assignment.TargetID != request.CardID {
			return EntityRevision{}, errors.New("flashcard tag assignment does not belong to the reviewed card")
		}
	}
	return NewOperationEntityRevision(request.OperationID, target.EntityType, target.EntityID,
		[]string{target.RevisionID}, request.UndoneAt, deleted, payload)
}

func (request *ReviewUndoRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.ReviewEventID) == "" ||
		strings.TrimSpace(request.CardID) == "" {
		return errors.New("flashcard review undo operation, event, and card IDs are required")
	}
	if request.UndoneAt <= 0 {
		return errors.New("flashcard review undo time is invalid")
	}
	return nil
}

func reviewUndoResultFromBatch(batch OperationBatch, request ReviewUndoRequest) (ReviewUndoResult, error) {
	result := ReviewUndoResult{Batch: batch, ReviewEventID: request.ReviewEventID, CardID: request.CardID}
	for _, change := range batch.Changes {
		switch change.Kind {
		case RecordEvent:
			if change.Event == nil || change.Event.EventType != EventReviewUndone {
				continue
			}
			var payload ReviewUndoneEventPayload
			if err := decodeStrictJSON(change.Event.Payload, &payload); err != nil {
				return ReviewUndoResult{}, err
			}
			if payload.ReviewEventID != request.ReviewEventID || payload.CardID != request.CardID ||
				payload.UndoneAt != request.UndoneAt {
				return ReviewUndoResult{}, ErrOperationConflict
			}
			result.Event = *change.Event
		case RecordEntityRevision:
			if change.Revision == nil {
				continue
			}
			switch change.Revision.EntityType {
			case EntityReviewState:
				var state ReviewState
				if err := decodeStrictJSON(change.Revision.Payload, &state); err != nil {
					return ReviewUndoResult{}, err
				}
				if state.CardID == request.CardID {
					snapshot := state.ReviewStateSnapshot
					result.RestoredState = &snapshot
				} else {
					result.RestoredSiblingIDs = append(result.RestoredSiblingIDs, state.CardID)
				}
			case EntitySessionCard:
				var sessionCard SessionCard
				if err := decodeStrictJSON(change.Revision.Payload, &sessionCard); err != nil {
					return ReviewUndoResult{}, err
				}
				if sessionCard.CardID == request.CardID {
					result.SessionCard = &sessionCard
				} else {
					result.RestoredSessionCardIDs = append(result.RestoredSessionCardIDs, sessionCard.CardID)
				}
			case EntityTagAssignment:
				result.LeechTagRemoved = change.Revision.Deleted
			}
		}
	}
	if result.Event.EventID == "" {
		return ReviewUndoResult{}, ErrOperationConflict
	}
	sort.Strings(result.RestoredSiblingIDs)
	sort.Strings(result.RestoredSessionCardIDs)
	return result, nil
}

func (projection *Projection) reviewEventByID(ctx context.Context,
	eventID string) (Event, ReviewEventPayload, string, bool, error) {
	var event Event
	var payload []byte
	var batchID string
	err := projection.db.QueryRowContext(ctx, `SELECT event_id, entity_id, occurred_at, payload, batch_id
		FROM events WHERE event_id = ? AND event_type = ?`, eventID, EventReview).
		Scan(&event.EventID, &event.EntityID, &event.OccurredAt, &payload, &batchID)
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ReviewEventPayload{}, "", false, nil
	}
	if err != nil {
		return Event{}, ReviewEventPayload{}, "", false, fmt.Errorf("query flashcard review event: %w", err)
	}
	event.EventType = EventReview
	event.Payload = json.RawMessage(payload)
	var value ReviewEventPayload
	if err = decodeStrictJSON(event.Payload, &value); err != nil {
		return Event{}, ReviewEventPayload{}, "", false, err
	}
	return event, value, batchID, true, nil
}

func (projection *Projection) entityRevisionsForBatch(ctx context.Context, batchID string) ([]EntityRevision, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT entity_type, entity_id, revision_id, parent_revision_ids,
		updated_at, deleted, payload FROM entity_revisions WHERE batch_id = ? ORDER BY entity_type, entity_id`, batchID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard review revisions: %w", err)
	}
	defer rows.Close()
	var ret []EntityRevision
	for rows.Next() {
		var revision EntityRevision
		var parents, payload []byte
		if err = rows.Scan(&revision.EntityType, &revision.EntityID, &revision.RevisionID, &parents,
			&revision.UpdatedAt, &revision.Deleted, &payload); err != nil {
			return nil, fmt.Errorf("scan flashcard review revision: %w", err)
		}
		if err = json.Unmarshal(parents, &revision.ParentRevisionIDs); err != nil {
			return nil, fmt.Errorf("decode flashcard review revision parents: %w", err)
		}
		revision.Payload = json.RawMessage(payload)
		ret = append(ret, revision)
	}
	return ret, rows.Err()
}

func (projection *Projection) entityHasUnresolvedConflict(ctx context.Context, entityType EntityType,
	entityID string) (bool, error) {
	var found int
	if err := projection.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM entity_conflicts
		WHERE entity_type = ? AND entity_id = ? AND resolved = 0)`, entityType, entityID).Scan(&found); err != nil {
		return false, fmt.Errorf("query flashcard entity conflict: %w", err)
	}
	return found != 0, nil
}

func (projection *Projection) undoneReviewEventIDs(ctx context.Context, cardID string) (map[string]struct{}, error) {
	query := "SELECT payload FROM events WHERE event_type = ?"
	arguments := []any{EventReviewUndone}
	if cardID != "" {
		query += " AND entity_id = ?"
		arguments = append(arguments, cardID)
	}
	rows, err := projection.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query flashcard review undo events: %w", err)
	}
	defer rows.Close()
	ret := map[string]struct{}{}
	for rows.Next() {
		var payload []byte
		if err = rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("scan flashcard review undo event: %w", err)
		}
		var value ReviewUndoneEventPayload
		if err = decodeStrictJSON(payload, &value); err != nil {
			return nil, err
		}
		ret[value.ReviewEventID] = struct{}{}
	}
	return ret, rows.Err()
}
