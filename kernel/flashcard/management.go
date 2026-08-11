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

const (
	CardActionSuspend     = "suspend"
	CardActionResume      = "resume"
	CardActionBury        = "bury"
	CardActionUnbury      = "unbury"
	CardActionReset       = "reset"
	CardActionSetDue      = "setDue"
	CardActionSetFlag     = "setFlag"
	CardActionSetPreset   = "setPreset"
	CardActionSetPriority = "setPriority"
)

// CardManagementRequest 描述一个可以批量、安全重试的单卡管理操作。
type CardManagementRequest struct {
	OperationID            string            `json:"operationID"`
	CardIDs                []string          `json:"cardIDs"`
	Action                 string            `json:"action"`
	ChangedAt              int64             `json:"changedAt"`
	Due                    int64             `json:"due,omitempty"`
	BuriedUntil            int64             `json:"buriedUntil,omitempty"`
	Reason                 string            `json:"reason,omitempty"`
	Flag                   int               `json:"flag,omitempty"`
	PresetID               string            `json:"presetID,omitempty"`
	Priority               string            `json:"priority,omitempty"`
	ExpectedCardRevisions  map[string]string `json:"expectedCardRevisions,omitempty"`
	ExpectedStateRevisions map[string]string `json:"expectedStateRevisions,omitempty"`
}

type cardManagementInput struct {
	Due         int64  `json:"due,omitempty"`
	BuriedUntil int64  `json:"buriedUntil,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Flag        int    `json:"flag,omitempty"`
	PresetID    string `json:"presetID,omitempty"`
	Priority    string `json:"priority,omitempty"`
}

// CardManagementResult 返回本次修改涉及的卡片、状态和审计事件。
type CardManagementResult struct {
	Batch  OperationBatch         `json:"batch"`
	Cards  map[string]Card        `json:"cards"`
	States map[string]ReviewState `json:"states"`
	Events []Event                `json:"events"`
}

// ManageCards 原子执行暂停、埋藏、重置、改期、旗标、预设或优先级操作。
func (store *Store) ManageCards(ctx context.Context, request CardManagementRequest) (CardManagementResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return CardManagementResult{}, errors.New("flashcard store is closed")
	}
	if err := request.validate(); err != nil {
		return CardManagementResult{}, err
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return CardManagementResult{}, err
	} else if found {
		return cardManagementResultFromBatch(existing, request)
	}
	cardIDs := append([]string(nil), request.CardIDs...)
	sort.Strings(cardIDs)
	changes := make([]Change, 0, len(cardIDs)*2)
	for _, cardID := range cardIDs {
		conflicted, err := store.projection.CardHasUnresolvedConflict(ctx, cardID)
		if err != nil {
			return CardManagementResult{}, err
		}
		if conflicted {
			return CardManagementResult{}, fmt.Errorf("flashcard [%s] has an unresolved entity conflict", cardID)
		}
		cardRevision, found, err := store.projection.CurrentEntity(ctx, EntityCard, cardID)
		if err != nil {
			return CardManagementResult{}, err
		}
		if !found || cardRevision.Deleted {
			return CardManagementResult{}, fmt.Errorf("%w: card [%s]", ErrEntityNotFound, cardID)
		}
		if expected := request.ExpectedCardRevisions[cardID]; expected != "" && expected != cardRevision.RevisionID {
			return CardManagementResult{}, fmt.Errorf("%w: card [%s]", ErrRevisionConflict, cardID)
		}
		stateRevision, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
		if err != nil {
			return CardManagementResult{}, err
		}
		if !found || stateRevision.Deleted {
			return CardManagementResult{}, fmt.Errorf("%w: review state [%s]", ErrEntityNotFound, cardID)
		}
		if expected := request.ExpectedStateRevisions[cardID]; expected != "" && expected != stateRevision.RevisionID {
			return CardManagementResult{}, fmt.Errorf("%w: review state [%s]", ErrRevisionConflict, cardID)
		}
		var card Card
		var state ReviewState
		if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
			return CardManagementResult{}, err
		}
		if err = decodeStrictJSON(stateRevision.Payload, &state); err != nil {
			return CardManagementResult{}, err
		}
		beforeCard := card
		beforeState := state.ReviewStateSnapshot
		cardChanged, stateChanged, err := applyCardManagementAction(&card, &state, request)
		if err != nil {
			return CardManagementResult{}, err
		}
		if cardChanged {
			card.UpdatedAt = request.ChangedAt
			updated, revisionErr := NewOperationEntityRevision(request.OperationID, EntityCard, card.ID,
				[]string{cardRevision.RevisionID}, request.ChangedAt, false, card)
			if revisionErr != nil {
				return CardManagementResult{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &updated})
		}
		if stateChanged {
			state.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, card.ID)
			updated, revisionErr := NewOperationEntityRevision(request.OperationID, EntityReviewState, card.ID,
				[]string{stateRevision.RevisionID}, request.ChangedAt, false, state)
			if revisionErr != nil {
				return CardManagementResult{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &updated})
		}
		inputJSON, err := CanonicalJSON(request.input())
		if err != nil {
			return CardManagementResult{}, err
		}
		payload := CardManagementEventPayload{
			CardID: card.ID, Action: request.Action, ChangedAt: request.ChangedAt, Input: inputJSON,
		}
		if cardChanged {
			payload.BeforeCard = &beforeCard
			payload.AfterCard = &card
		}
		if stateChanged {
			payload.BeforeState = &beforeState
			after := state.ReviewStateSnapshot
			payload.AfterState = &after
		}
		payloadJSON, err := CanonicalJSON(payload)
		if err != nil {
			return CardManagementResult{}, err
		}
		event := Event{
			EventType: EventCardStateChanged,
			EventID:   DeterministicID("card-management-event", request.OperationID, card.ID),
			EntityID:  card.ID, OccurredAt: request.ChangedAt, Payload: payloadJSON,
		}
		if err = event.Validate(); err != nil {
			return CardManagementResult{}, err
		}
		changes = append(changes, Change{Kind: RecordEvent, Event: &event})
	}
	if err := store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return CardManagementResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return CardManagementResult{}, err
	}
	return cardManagementResultFromBatch(batch, request)
}

func (request *CardManagementRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || request.ChangedAt <= 0 || len(request.CardIDs) == 0 {
		return errors.New("flashcard management operation, cards and time are required")
	}
	seen := make(map[string]struct{}, len(request.CardIDs))
	for _, cardID := range request.CardIDs {
		if strings.TrimSpace(cardID) == "" {
			return errors.New("flashcard management card ID is required")
		}
		if _, duplicate := seen[cardID]; duplicate {
			return fmt.Errorf("duplicate managed flashcard [%s]", cardID)
		}
		seen[cardID] = struct{}{}
	}
	switch request.Action {
	case CardActionSuspend, CardActionResume, CardActionUnbury, CardActionReset:
	case CardActionBury:
		if request.BuriedUntil <= request.ChangedAt || strings.TrimSpace(request.Reason) == "" {
			return errors.New("burying a flashcard requires a future time and reason")
		}
	case CardActionSetDue:
		if request.Due < 0 {
			return errors.New("flashcard due time must not be negative")
		}
	case CardActionSetFlag:
		if request.Flag < 0 || request.Flag > 7 {
			return errors.New("flashcard flag must be between zero and seven")
		}
	case CardActionSetPreset:
	case CardActionSetPriority:
		if request.Priority != "" && !validStudyPriority(request.Priority) {
			return fmt.Errorf("unsupported flashcard priority [%s]", request.Priority)
		}
	default:
		return fmt.Errorf("unsupported flashcard management action [%s]", request.Action)
	}
	return nil
}

func (request *CardManagementRequest) input() cardManagementInput {
	input := cardManagementInput{}
	switch request.Action {
	case CardActionBury:
		input.BuriedUntil = request.BuriedUntil
		input.Reason = request.Reason
	case CardActionSetDue:
		input.Due = request.Due
	case CardActionSetFlag:
		input.Flag = request.Flag
	case CardActionSetPreset:
		input.PresetID = request.PresetID
	case CardActionSetPriority:
		input.Priority = request.Priority
	}
	return input
}

func applyCardManagementAction(card *Card, state *ReviewState, request CardManagementRequest) (bool, bool, error) {
	switch request.Action {
	case CardActionSuspend:
		state.Suspended = true
		return false, true, nil
	case CardActionResume:
		state.Suspended = false
		return false, true, nil
	case CardActionBury:
		state.BuriedUntil = request.BuriedUntil
		state.BuriedReason = request.Reason
		return false, true, nil
	case CardActionUnbury:
		state.BuriedUntil = 0
		state.BuriedReason = ""
		return false, true, nil
	case CardActionReset:
		suspended := state.Suspended
		buriedUntil := state.BuriedUntil
		buriedReason := state.BuriedReason
		state.ReviewStateSnapshot = ReviewStateSnapshot{
			State: "new", Due: request.ChangedAt, Suspended: suspended, BuriedUntil: buriedUntil,
			BuriedReason: buriedReason,
		}
		return false, true, nil
	case CardActionSetDue:
		state.Due = request.Due
		return false, true, nil
	case CardActionSetFlag:
		card.Flag = request.Flag
		return true, false, nil
	case CardActionSetPreset:
		card.PresetOverrideID = request.PresetID
		return true, false, nil
	case CardActionSetPriority:
		card.PriorityOverride = request.Priority
		return true, false, nil
	default:
		return false, false, fmt.Errorf("unsupported flashcard management action [%s]", request.Action)
	}
}

func cardManagementResultFromBatch(batch OperationBatch,
	request CardManagementRequest) (CardManagementResult, error) {
	result := CardManagementResult{
		Batch: batch, Cards: map[string]Card{}, States: map[string]ReviewState{}, Events: []Event{},
	}
	expected := make(map[string]struct{}, len(request.CardIDs))
	for _, cardID := range request.CardIDs {
		expected[cardID] = struct{}{}
	}
	inputJSON, err := CanonicalJSON(request.input())
	if err != nil {
		return CardManagementResult{}, err
	}
	eventCards := make(map[string]struct{}, len(expected))
	for _, change := range batch.Changes {
		switch change.Kind {
		case RecordEntityRevision:
			if change.Revision == nil || change.Revision.UpdatedAt != request.ChangedAt {
				return CardManagementResult{}, ErrOperationConflict
			}
			switch change.Revision.EntityType {
			case EntityCard:
				var card Card
				if err = decodeStrictJSON(change.Revision.Payload, &card); err != nil {
					return CardManagementResult{}, ErrOperationConflict
				}
				result.Cards[card.ID] = card
			case EntityReviewState:
				var state ReviewState
				if err = decodeStrictJSON(change.Revision.Payload, &state); err != nil {
					return CardManagementResult{}, ErrOperationConflict
				}
				result.States[state.CardID] = state
			default:
				return CardManagementResult{}, ErrOperationConflict
			}
		case RecordEvent:
			if change.Event == nil || change.Event.EventType != EventCardStateChanged {
				return CardManagementResult{}, ErrOperationConflict
			}
			var payload CardManagementEventPayload
			if err = decodeStrictJSON(change.Event.Payload, &payload); err != nil ||
				payload.Action != request.Action || payload.ChangedAt != request.ChangedAt ||
				string(payload.Input) != string(inputJSON) {
				return CardManagementResult{}, ErrOperationConflict
			}
			if _, found := expected[payload.CardID]; !found {
				return CardManagementResult{}, ErrOperationConflict
			}
			eventCards[payload.CardID] = struct{}{}
			result.Events = append(result.Events, *change.Event)
		default:
			return CardManagementResult{}, ErrOperationConflict
		}
	}
	if len(eventCards) != len(expected) {
		return CardManagementResult{}, ErrOperationConflict
	}
	return result, nil
}

// CardHistory 返回单卡的评分、管理和并发消解历史。
func (projection *Projection) CardHistory(ctx context.Context, cardID string, limit, offset int) ([]Event, error) {
	if strings.TrimSpace(cardID) == "" || limit < 0 || limit > maxCardSearchLimit || offset < 0 {
		return nil, errors.New("flashcard history query is invalid")
	}
	if limit == 0 {
		limit = maxCardSearchLimit
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT event_type, event_id, entity_id, occurred_at, payload
		FROM events WHERE entity_id = ? ORDER BY occurred_at DESC, event_id DESC LIMIT ? OFFSET ?`, cardID, limit,
		offset)
	if err != nil {
		return nil, fmt.Errorf("query flashcard history: %w", err)
	}
	defer rows.Close()
	ret := make([]Event, 0)
	for rows.Next() {
		var event Event
		var payload []byte
		if err = rows.Scan(&event.EventType, &event.EventID, &event.EntityID, &event.OccurredAt, &payload); err != nil {
			return nil, fmt.Errorf("scan flashcard history: %w", err)
		}
		event.Payload = json.RawMessage(payload)
		ret = append(ret, event)
	}
	return ret, rows.Err()
}

// DeleteReviewSet 删除复习集及其静态成员关系，不删除卡片、排期和历史会话。
func (store *Store) DeleteReviewSet(ctx context.Context, operationID, reviewSetID, expectedRevisionID string,
	deletedAt int64) (EntityMutationResult, error) {
	if strings.TrimSpace(operationID) == "" || strings.TrimSpace(reviewSetID) == "" || deletedAt <= 0 {
		return EntityMutationResult{}, errors.New("flashcard review set deletion request is invalid")
	}
	revision, found, err := store.projection.CurrentEntity(ctx, EntityReviewSet, reviewSetID)
	if err != nil {
		return EntityMutationResult{}, err
	}
	if !found || revision.Deleted {
		return EntityMutationResult{}, ErrEntityNotFound
	}
	if expectedRevisionID != "" && revision.RevisionID != expectedRevisionID {
		return EntityMutationResult{}, ErrRevisionConflict
	}
	var activeSessions int
	if err = store.projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM study_sessions
		WHERE review_set_id = ? AND status = 'active'`, reviewSetID).Scan(&activeSessions); err != nil {
		return EntityMutationResult{}, fmt.Errorf("count active flashcard review set sessions: %w", err)
	}
	if activeSessions != 0 {
		return EntityMutationResult{}, errors.New("flashcard review set has an active study session")
	}
	rows, err := store.projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id
		FROM entities e JOIN review_set_memberships m ON m.id = e.entity_id
		WHERE e.entity_type = ? AND e.deleted = 0 AND m.review_set_id = ? ORDER BY e.entity_id`,
		EntityReviewSetMembership, reviewSetID)
	if err != nil {
		return EntityMutationResult{}, fmt.Errorf("query flashcard review set memberships for deletion: %w", err)
	}
	mutations := make([]EntityMutation, 0)
	for rows.Next() {
		var entityID, membershipRevisionID string
		if err = rows.Scan(&entityID, &membershipRevisionID); err != nil {
			_ = rows.Close()
			return EntityMutationResult{}, fmt.Errorf("scan flashcard review set membership for deletion: %w", err)
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership, EntityID: entityID,
			ExpectedRevisionID: membershipRevisionID, UpdatedAt: deletedAt, Deleted: true,
			Payload: json.RawMessage(`{}`)})
	}
	if err = rows.Close(); err != nil {
		return EntityMutationResult{}, err
	}
	mutations = append(mutations, EntityMutation{EntityType: EntityReviewSet, EntityID: reviewSetID,
		ExpectedRevisionID: revision.RevisionID, UpdatedAt: deletedAt, Deleted: true, Payload: json.RawMessage(`{}`)})
	return store.MutateEntities(ctx, operationID, mutations)
}
