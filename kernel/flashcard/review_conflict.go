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
	"sort"
)

const reviewConflictAlgorithm = "fsrs-concurrent-review-v1"

var errReviewConflictDeferred = errors.New("flashcard review conflict requires manual resolution")

// ReviewConflictResolvedPayload 保存确定性重放的输入分支和最终状态。
type ReviewConflictResolvedPayload struct {
	CardID            string              `json:"cardID"`
	BaseRevisionID    string              `json:"baseRevisionID"`
	ParentRevisionIDs []string            `json:"parentRevisionIDs"`
	ReviewEventIDs    []string            `json:"reviewEventIDs"`
	Algorithm         string              `json:"algorithm"`
	ResolvedState     ReviewStateSnapshot `json:"resolvedState"`
}

// ReviewConflictReport 列出自动解决和因缺少兼容信息而保留的卡片。
type ReviewConflictReport struct {
	ResolvedCardIDs []string
	DeferredCardIDs []string
}

// ResolveReviewConflicts 确定性重放可以安全识别的并发评分分支。
func (store *Store) ResolveReviewConflicts(ctx context.Context) (ReviewConflictReport, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReviewConflictReport{}, errors.New("flashcard store is closed")
	}
	return store.resolveReviewConflictsLocked(ctx)
}

func (store *Store) resolveReviewConflictsLocked(ctx context.Context) (ReviewConflictReport, error) {
	cardIDs, err := store.projection.unresolvedConflictEntityIDs(ctx, EntityReviewState)
	if err != nil {
		return ReviewConflictReport{}, err
	}
	report := ReviewConflictReport{}
	for _, cardID := range cardIDs {
		resolved, resolveErr := store.resolveReviewConflictLocked(ctx, cardID)
		if errors.Is(resolveErr, errReviewConflictDeferred) {
			report.DeferredCardIDs = append(report.DeferredCardIDs, cardID)
			continue
		}
		if resolveErr != nil {
			return ReviewConflictReport{}, fmt.Errorf("resolve review conflict for card [%s]: %w", cardID, resolveErr)
		}
		if resolved {
			report.ResolvedCardIDs = append(report.ResolvedCardIDs, cardID)
		} else {
			report.DeferredCardIDs = append(report.DeferredCardIDs, cardID)
		}
	}
	return report, nil
}

func (store *Store) resolveReviewConflictLocked(ctx context.Context, cardID string) (bool, error) {
	leaves, err := store.reviewConflictLeaves(ctx, cardID)
	if err != nil {
		return false, err
	}
	if len(leaves) < 2 {
		return false, errReviewConflictDeferred
	}
	events, err := store.projection.reviewEventsForCard(ctx, cardID)
	if err != nil {
		return false, err
	}
	leavesSet := make(map[string]struct{}, len(leaves))
	for _, revisionID := range leaves {
		leavesSet[revisionID] = struct{}{}
	}
	eventByRevision := map[string]Event{}
	for _, event := range events {
		var payload ReviewEventPayload
		if err = decodeStrictJSON(event.Payload, &payload); err != nil {
			return false, err
		}
		if payload.AfterState == nil {
			continue
		}
		if _, found := leavesSet[payload.AfterState.StateRevisionID]; found {
			eventByRevision[payload.AfterState.StateRevisionID] = event
		}
	}
	if len(eventByRevision) != len(leaves) {
		return false, errReviewConflictDeferred
	}
	orderedEvents := make([]Event, 0, len(leaves))
	baseRevisionID := ""
	for _, revisionID := range leaves {
		event := eventByRevision[revisionID]
		var payload ReviewEventPayload
		if err = decodeStrictJSON(event.Payload, &payload); err != nil {
			return false, err
		}
		if payload.ReviewMode != "normal" || payload.Kind != "review" ||
			payload.SchedulerVersion != SchedulerVersionFSRS6 || payload.BeforeState == nil {
			return false, errReviewConflictDeferred
		}
		if baseRevisionID == "" {
			baseRevisionID = payload.BaseStateRevisionID
		} else if baseRevisionID != payload.BaseStateRevisionID {
			return false, errReviewConflictDeferred
		}
		orderedEvents = append(orderedEvents, event)
	}
	sort.Slice(orderedEvents, func(i, j int) bool {
		if orderedEvents[i].OccurredAt != orderedEvents[j].OccurredAt {
			return orderedEvents[i].OccurredAt < orderedEvents[j].OccurredAt
		}
		return orderedEvents[i].EventID < orderedEvents[j].EventID
	})
	baseRevision, found, err := store.projection.entityRevisionByID(ctx, baseRevisionID)
	if err != nil {
		return false, err
	}
	if !found || baseRevision.Deleted || baseRevision.EntityType != EntityReviewState ||
		baseRevision.EntityID != cardID {
		return false, errReviewConflictDeferred
	}
	var baseState ReviewState
	if err = decodeStrictJSON(baseRevision.Payload, &baseState); err != nil {
		return false, err
	}
	current := baseState.ReviewStateSnapshot
	for _, event := range orderedEvents {
		var payload ReviewEventPayload
		if err = decodeStrictJSON(event.Payload, &payload); err != nil {
			return false, err
		}
		if !sameEntityPayload(baseState.ReviewStateSnapshot, *payload.BeforeState) {
			return false, errReviewConflictDeferred
		}
		var input schedulerInput
		if err = decodeStrictJSON(payload.SchedulerInput, &input); err != nil {
			return false, errReviewConflictDeferred
		}
		if input.Rating != payload.Rating || input.ReviewedAt != payload.ReviewedAt ||
			len(input.Weights) != 19 || input.EnableShortTerm || input.EnableFuzz {
			return false, errReviewConflictDeferred
		}
		preset := SchedulerPreset{
			SchedulerVersion: SchedulerVersionFSRS6,
			RequestRetention: input.RequestRetention,
			MaximumInterval:  input.MaximumInterval,
			Weights:          input.Weights,
			LeechThreshold:   input.LeechThreshold,
			LeechAction:      input.LeechAction,
		}
		request := ReviewRequest{Rating: payload.Rating, ReviewedAt: payload.ReviewedAt}
		current, err = scheduleReview(current, preset, request)
		if err != nil {
			return false, errReviewConflictDeferred
		}
		if input.LeechThreshold > 0 && int(current.Lapses) >= input.LeechThreshold &&
			(input.LeechAction == "suspend" || input.LeechAction == "tagAndSuspend") {
			current.Suspended = true
		}
		current.StateRevisionID = DeterministicID("review-conflict-step", event.EventID)
	}
	eventIDs := make([]string, 0, len(orderedEvents))
	resolvedAt := int64(0)
	for _, event := range orderedEvents {
		eventIDs = append(eventIDs, event.EventID)
		resolvedAt = maxInt64(resolvedAt, event.OccurredAt)
	}
	operationParts := append([]string{cardID, baseRevisionID}, eventIDs...)
	operationID := DeterministicID("review-conflict-operation", operationParts...)
	current.StateRevisionID = OperationRevisionID(operationID, EntityReviewState, cardID)
	parents := append([]string(nil), leaves...)
	sort.Strings(parents)
	stateRevision, err := NewOperationEntityRevision(operationID, EntityReviewState, cardID, parents, resolvedAt,
		false, ReviewState{CardID: cardID, ReviewStateSnapshot: current})
	if err != nil {
		return false, err
	}
	resolutionPayload := ReviewConflictResolvedPayload{
		CardID: cardID, BaseRevisionID: baseRevisionID, ParentRevisionIDs: parents,
		ReviewEventIDs: eventIDs, Algorithm: reviewConflictAlgorithm, ResolvedState: current,
	}
	payload, err := CanonicalJSON(resolutionPayload)
	if err != nil {
		return false, err
	}
	resolutionEvent := Event{
		EventType:  EventReviewConflictResolved,
		EventID:    DeterministicID("review-conflict-resolved-event", operationParts...),
		EntityID:   cardID,
		OccurredAt: resolvedAt,
		Payload:    payload,
	}
	if err = resolutionEvent.Validate(); err != nil {
		return false, err
	}
	_, err = store.applyLocked(ctx, operationID, []Change{
		{Kind: RecordEntityRevision, Revision: &stateRevision},
		{Kind: RecordEvent, Event: &resolutionEvent},
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func (store *Store) reviewConflictLeaves(ctx context.Context, cardID string) ([]string, error) {
	conflicts, err := store.projection.conflictRevisionIDs(ctx, EntityReviewState, cardID)
	if err != nil {
		return nil, err
	}
	current, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil {
		return nil, err
	}
	if found {
		conflicts = append(conflicts, current.RevisionID)
	}
	unique := map[string]struct{}{}
	for _, revisionID := range conflicts {
		unique[revisionID] = struct{}{}
	}
	candidates := make([]string, 0, len(unique))
	for revisionID := range unique {
		candidates = append(candidates, revisionID)
	}
	sort.Strings(candidates)
	var leaves []string
	for _, candidate := range candidates {
		ancestor := false
		for _, other := range candidates {
			if candidate == other {
				continue
			}
			isAncestor, ancestorErr := store.projection.isAncestor(ctx, candidate, other)
			if ancestorErr != nil {
				return nil, ancestorErr
			}
			if isAncestor {
				ancestor = true
				break
			}
		}
		if !ancestor {
			leaves = append(leaves, candidate)
		}
	}
	return leaves, nil
}
