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
	"time"

	"github.com/open-spaced-repetition/go-fsrs/v3"
)

// ReviewRequest 保存一次正常或强化复习的完整调用输入。
type ReviewRequest struct {
	OperationID  string          `json:"operationID"`
	CardID       string          `json:"cardID"`
	Rating       ReviewRating    `json:"rating"`
	ReviewedAt   int64           `json:"reviewedAt"`
	DurationMS   int64           `json:"durationMS"`
	SessionID    string          `json:"sessionID,omitempty"`
	ReviewSetID  string          `json:"reviewSetID,omitempty"`
	ReviewMode   string          `json:"reviewMode"`
	BuryUntil    int64           `json:"buryUntil,omitempty"`
	AnswerResult json.RawMessage `json:"answerResult,omitempty"`
}

// ReviewResult 返回持久化事件、前后状态和本次埋藏的兄弟卡。
type ReviewResult struct {
	Batch                 OperationBatch       `json:"batch"`
	Event                 Event                `json:"event"`
	BeforeState           ReviewStateSnapshot  `json:"beforeState"`
	AfterState            *ReviewStateSnapshot `json:"afterState,omitempty"`
	BuriedSiblingIDs      []string             `json:"buriedSiblingIDs"`
	SkippedSessionCardIDs []string             `json:"skippedSessionCardIDs"`
	SessionCard           *SessionCard         `json:"sessionCard,omitempty"`
	LeechTagged           bool                 `json:"leechTagged"`
	PresetRevisionID      string               `json:"presetRevisionID"`
	SchedulerVersion      string               `json:"schedulerVersion"`
}

type schedulerInput struct {
	Rating           ReviewRating `json:"rating"`
	ReviewedAt       int64        `json:"reviewedAt"`
	RequestRetention float64      `json:"requestRetention"`
	MaximumInterval  int          `json:"maximumInterval"`
	Weights          []float64    `json:"weights"`
	EnableShortTerm  bool         `json:"enableShortTerm"`
	EnableFuzz       bool         `json:"enableFuzz"`
	BuryUntil        int64        `json:"buryUntil,omitempty"`
	LeechThreshold   int          `json:"leechThreshold"`
	LeechAction      string       `json:"leechAction"`
}

// ReviewCard 以 CardID 为目标原子写入状态修订、完整复习事件和兄弟卡埋藏。
func (store *Store) ReviewCard(ctx context.Context, request ReviewRequest) (ReviewResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReviewResult{}, errors.New("flashcard store is closed")
	}
	if err := request.validate(); err != nil {
		return ReviewResult{}, err
	}
	if batch, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return ReviewResult{}, err
	} else if found {
		return reviewResultFromBatch(batch, request)
	}
	cardRevision, found, err := store.projection.CurrentEntity(ctx, EntityCard, request.CardID)
	if err != nil {
		return ReviewResult{}, err
	}
	if !found || cardRevision.Deleted {
		return ReviewResult{}, errors.New("flashcard was not found")
	}
	conflicted, err := store.projection.CardHasUnresolvedConflict(ctx, request.CardID)
	if err != nil {
		return ReviewResult{}, err
	}
	if conflicted {
		return ReviewResult{}, errors.New("flashcard has an unresolved entity conflict")
	}
	var card Card
	if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
		return ReviewResult{}, err
	}
	if card.GenerationStatus != GenerationActive {
		return ReviewResult{}, fmt.Errorf("flashcard [%s] is not active", card.ID)
	}
	sourceRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, card.SourceID)
	if err != nil {
		return ReviewResult{}, err
	}
	if !found || sourceRevision.Deleted {
		return ReviewResult{}, errors.New("flashcard source was not found")
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		return ReviewResult{}, err
	}
	presetID := source.DefaultPresetID
	if card.PresetOverrideID != "" {
		presetID = card.PresetOverrideID
	}
	if presetID == "" {
		return ReviewResult{}, errors.New("flashcard has no scheduler preset")
	}
	presetRevision, found, err := store.projection.CurrentEntity(ctx, EntitySchedulerPreset, presetID)
	if err != nil {
		return ReviewResult{}, err
	}
	if !found || presetRevision.Deleted {
		return ReviewResult{}, errors.New("flashcard scheduler preset was not found")
	}
	var preset SchedulerPreset
	if err = decodeStrictJSON(presetRevision.Payload, &preset); err != nil {
		return ReviewResult{}, err
	}
	stateRevision, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, card.ID)
	if err != nil {
		return ReviewResult{}, err
	}
	if !found || stateRevision.Deleted {
		return ReviewResult{}, errors.New("flashcard review state was not found")
	}
	var state ReviewState
	if err = decodeStrictJSON(stateRevision.Payload, &state); err != nil {
		return ReviewResult{}, err
	}
	if state.Suspended && request.ReviewMode == "normal" {
		return ReviewResult{}, errors.New("suspended flashcard cannot be reviewed normally")
	}
	if request.ReviewMode == "normal" {
		queryValue, queryErr := CanonicalJSON(request.CardID)
		if queryErr != nil {
			return ReviewResult{}, queryErr
		}
		query := QueryAST{Version: QueryVersion, Root: QueryExpression{
			Operator: QueryPredicate, Field: "cardID", Comparator: QueryEqual, Value: queryValue,
		}}
		eligible, queryErr := store.projection.SearchCards(ctx, &query, CardSearchOptions{
			Now: request.ReviewedAt, Limit: 1,
		})
		if queryErr != nil {
			return ReviewResult{}, queryErr
		}
		if len(eligible) != 1 || eligible[0].ReviewState.Due > request.ReviewedAt {
			return ReviewResult{}, errors.New("flashcard is no longer eligible for normal review")
		}
	}
	before := state.ReviewStateSnapshot
	if request.ReviewMode == "normal" && before.LastReview > request.ReviewedAt {
		return ReviewResult{}, errors.New("flashcard review time precedes the current state")
	}
	input := schedulerInput{
		Rating: request.Rating, ReviewedAt: request.ReviewedAt, RequestRetention: preset.RequestRetention,
		MaximumInterval: preset.MaximumInterval, Weights: append([]float64(nil), preset.Weights...),
		EnableShortTerm: false, EnableFuzz: false, BuryUntil: request.BuryUntil,
		LeechThreshold: preset.LeechThreshold, LeechAction: preset.LeechAction,
	}
	inputJSON, err := CanonicalJSON(input)
	if err != nil {
		return ReviewResult{}, err
	}
	duration := request.DurationMS
	eventPayload := ReviewEventPayload{
		CardID: card.ID, SourceID: card.SourceID, Kind: "review", Rating: request.Rating,
		ReviewedAt: request.ReviewedAt, DurationMS: &duration, BaseStateRevisionID: stateRevision.RevisionID,
		BeforeState: &before, SchedulerVersion: preset.SchedulerVersion, PresetRevisionID: presetRevision.RevisionID,
		SchedulerInput: inputJSON, SessionID: request.SessionID, ReviewSetID: request.ReviewSetID,
		ReviewMode:   request.ReviewMode,
		AnswerResult: request.AnswerResult,
	}
	var changes []Change
	result := ReviewResult{
		BeforeState:      before,
		PresetRevisionID: presetRevision.RevisionID,
		SchedulerVersion: preset.SchedulerVersion,
	}
	if request.ReviewMode == "normal" {
		after, scheduleErr := scheduleReview(before, preset, request)
		if scheduleErr != nil {
			return ReviewResult{}, scheduleErr
		}
		stateRevisionID := OperationRevisionID(request.OperationID, EntityReviewState, card.ID)
		after.StateRevisionID = stateRevisionID
		if preset.LeechThreshold > 0 && int(after.Lapses) >= preset.LeechThreshold &&
			(preset.LeechAction == "suspend" || preset.LeechAction == "tagAndSuspend") {
			after.Suspended = true
		}
		updatedState := ReviewState{CardID: card.ID, ReviewStateSnapshot: after}
		updatedRevision, revisionErr := NewOperationEntityRevision(request.OperationID, EntityReviewState, card.ID,
			[]string{stateRevision.RevisionID}, request.ReviewedAt, false, updatedState)
		if revisionErr != nil {
			return ReviewResult{}, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &updatedRevision})
		if request.Rating == ReviewAgain && preset.LeechThreshold > 0 &&
			int(after.Lapses) >= preset.LeechThreshold &&
			(preset.LeechAction == "tag" || preset.LeechAction == "tagAndSuspend") {
			leechChanges, tagged, leechErr := store.leechTagChanges(ctx, request.OperationID, card.ID,
				request.ReviewedAt)
			if leechErr != nil {
				return ReviewResult{}, leechErr
			}
			changes = append(changes, leechChanges...)
			result.LeechTagged = tagged
		}
		eventPayload.AfterState = &after
		result.AfterState = &after
		buriedChanges, buriedIDs, buryErr := store.burySiblingCards(ctx, request, card, before, preset)
		if buryErr != nil {
			return ReviewResult{}, buryErr
		}
		changes = append(changes, buriedChanges...)
		result.BuriedSiblingIDs = buriedIDs
	}
	if request.SessionID != "" {
		sessionChange, sessionCard, sessionErr := store.reviewSessionCard(ctx, request, stateRevision.RevisionID)
		if sessionErr != nil {
			return ReviewResult{}, sessionErr
		}
		changes = append(changes, sessionChange)
		result.SessionCard = &sessionCard
		siblingChanges, skippedCardIDs, siblingErr := store.skipBuriedSessionSiblings(ctx, request,
			result.BuriedSiblingIDs)
		if siblingErr != nil {
			return ReviewResult{}, siblingErr
		}
		changes = append(changes, siblingChanges...)
		result.SkippedSessionCardIDs = skippedCardIDs
	}
	event, err := NewReviewEvent(request.OperationID, eventPayload)
	if err != nil {
		return ReviewResult{}, err
	}
	changes = append(changes, Change{Kind: RecordEvent, Event: &event})
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return ReviewResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return ReviewResult{}, err
	}
	result.Batch = batch
	result.Event = event
	sort.Strings(result.SkippedSessionCardIDs)
	return result, nil
}

func (store *Store) skipBuriedSessionSiblings(ctx context.Context, request ReviewRequest,
	cardIDs []string) ([]Change, []string, error) {
	changes := make([]Change, 0, len(cardIDs))
	skipped := make([]string, 0, len(cardIDs))
	for _, cardID := range cardIDs {
		entityID := DeterministicID("session-card", request.SessionID, cardID)
		revision, found, err := store.projection.CurrentEntity(ctx, EntitySessionCard, entityID)
		if err != nil {
			return nil, nil, err
		}
		if !found || revision.Deleted {
			continue
		}
		var sessionCard SessionCard
		if err = decodeStrictJSON(revision.Payload, &sessionCard); err != nil {
			return nil, nil, err
		}
		if sessionCard.Status != "queued" && sessionCard.Status != "shown" {
			continue
		}
		sessionCard.Status = "skipped"
		sessionCard.SkipReason = "siblingBuried"
		updated, revisionErr := NewOperationEntityRevision(request.OperationID, EntitySessionCard, entityID,
			[]string{revision.RevisionID}, request.ReviewedAt, false, sessionCard)
		if revisionErr != nil {
			return nil, nil, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &updated})
		skipped = append(skipped, cardID)
	}
	return changes, skipped, nil
}

func (store *Store) leechTagChanges(ctx context.Context, operationID, cardID string,
	updatedAt int64) ([]Change, bool, error) {
	changes := make([]Change, 0, 2)
	tagRevision, tagFound, err := store.projection.CurrentEntity(ctx, EntityTag, builtinLeechTagID)
	if err != nil {
		return nil, false, err
	}
	if !tagFound || tagRevision.Deleted {
		parents := []string(nil)
		if tagFound {
			parents = []string{tagRevision.RevisionID}
		}
		tag := Tag{ID: builtinLeechTagID, Name: "Leech", NormalizedName: NormalizeTagName("Leech")}
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityTag, tag.ID, parents, updatedAt,
			false, tag)
		if revisionErr != nil {
			return nil, false, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	assignmentID := DeterministicID("tag-assignment", builtinLeechTagID, "card", cardID)
	assignmentRevision, assignmentFound, err := store.projection.CurrentEntity(ctx, EntityTagAssignment,
		assignmentID)
	if err != nil {
		return nil, false, err
	}
	if assignmentFound && !assignmentRevision.Deleted {
		return changes, false, nil
	}
	parents := []string(nil)
	if assignmentFound {
		parents = []string{assignmentRevision.RevisionID}
	}
	assignment := TagAssignment{ID: assignmentID, TagID: builtinLeechTagID, TargetType: "card", TargetID: cardID}
	revision, err := NewOperationEntityRevision(operationID, EntityTagAssignment, assignment.ID, parents, updatedAt,
		false, assignment)
	if err != nil {
		return nil, false, err
	}
	changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	return changes, true, nil
}

func (store *Store) reviewSessionCard(ctx context.Context, request ReviewRequest,
	stateRevisionID string) (Change, SessionCard, error) {
	if err := store.requireActiveSession(ctx, request.SessionID, request.ReviewSetID, request.ReviewMode); err != nil {
		return Change{}, SessionCard{}, err
	}
	entityID := DeterministicID("session-card", request.SessionID, request.CardID)
	revision, found, err := store.projection.CurrentEntity(ctx, EntitySessionCard, entityID)
	if err != nil {
		return Change{}, SessionCard{}, err
	}
	if !found || revision.Deleted {
		return Change{}, SessionCard{}, errors.New("flashcard is not part of the study session")
	}
	var sessionCard SessionCard
	if err = decodeStrictJSON(revision.Payload, &sessionCard); err != nil {
		return Change{}, SessionCard{}, err
	}
	if sessionCard.Status != "queued" && sessionCard.Status != "shown" {
		return Change{}, SessionCard{}, fmt.Errorf("flashcard session card cannot be reviewed from status [%s]",
			sessionCard.Status)
	}
	if request.ReviewMode == "normal" && sessionCard.StateRevisionID != "" &&
		sessionCard.StateRevisionID != stateRevisionID {
		return Change{}, SessionCard{}, errors.New("flashcard schedule changed after the study session started")
	}
	sessionCard.Status = "reviewed"
	sessionCard.SkipReason = ""
	if len(request.AnswerResult) > 0 {
		sessionCard.StepResults = append(json.RawMessage(nil), request.AnswerResult...)
	}
	updated, err := NewOperationEntityRevision(request.OperationID, EntitySessionCard, entityID,
		[]string{revision.RevisionID}, request.ReviewedAt, false, sessionCard)
	if err != nil {
		return Change{}, SessionCard{}, err
	}
	return Change{Kind: RecordEntityRevision, Revision: &updated}, sessionCard, nil
}

func (request *ReviewRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.CardID) == "" {
		return errors.New("flashcard review operation and card IDs are required")
	}
	switch request.Rating {
	case ReviewAgain, ReviewHard, ReviewGood, ReviewEasy:
	default:
		return fmt.Errorf("unsupported flashcard review rating [%s]", request.Rating)
	}
	if request.ReviewedAt <= 0 || request.DurationMS < 0 {
		return errors.New("flashcard review time and duration are invalid")
	}
	if request.ReviewMode != "normal" && request.ReviewMode != "reinforcement" {
		return fmt.Errorf("unsupported flashcard review mode [%s]", request.ReviewMode)
	}
	if request.ReviewSetID != "" && request.SessionID == "" {
		return errors.New("flashcard review set requires a study session")
	}
	if request.BuryUntil < 0 {
		return errors.New("flashcard sibling burial time must not be negative")
	}
	if len(request.AnswerResult) > 65536 {
		return errors.New("flashcard review answer result is too large")
	}
	if err := validateOptionalJSON("flashcard review answer result", request.AnswerResult); err != nil {
		return err
	}
	return nil
}

func canonicalOptionalReviewAnswer(value json.RawMessage) (json.RawMessage, error) {
	if len(value) == 0 {
		return nil, nil
	}
	return canonicalRawMessage(value)
}

func scheduleReview(before ReviewStateSnapshot, preset SchedulerPreset,
	request ReviewRequest) (ReviewStateSnapshot, error) {
	parameters := fsrs.DefaultParam()
	parameters.RequestRetention = preset.RequestRetention
	parameters.MaximumInterval = float64(preset.MaximumInterval)
	parameters.EnableShortTerm = false
	parameters.EnableFuzz = false
	if len(preset.Weights) != len(parameters.W) {
		return ReviewStateSnapshot{}, errors.New("scheduler preset weight count is incompatible with FSRS-6")
	}
	copy(parameters.W[:], preset.Weights)
	fsrsState, err := toFSRSState(before.State)
	if err != nil {
		return ReviewStateSnapshot{}, err
	}
	card := fsrs.Card{
		Due:           millisToTime(before.Due),
		Stability:     before.Stability,
		Difficulty:    before.Difficulty,
		ElapsedDays:   before.ElapsedDays,
		ScheduledDays: before.ScheduledDays,
		Reps:          before.Reps,
		Lapses:        before.Lapses,
		State:         fsrsState,
		LastReview:    millisToTime(before.LastReview),
	}
	rating, err := toFSRSRating(request.Rating)
	if err != nil {
		return ReviewStateSnapshot{}, err
	}
	scheduled := fsrs.NewFSRS(parameters).Next(card, time.UnixMilli(request.ReviewedAt), rating).Card
	return ReviewStateSnapshot{
		State:         fromFSRSState(scheduled.State),
		Due:           timeToMillis(scheduled.Due),
		LastReview:    timeToMillis(scheduled.LastReview),
		Stability:     scheduled.Stability,
		Difficulty:    scheduled.Difficulty,
		ElapsedDays:   scheduled.ElapsedDays,
		ScheduledDays: scheduled.ScheduledDays,
		Reps:          scheduled.Reps,
		Lapses:        scheduled.Lapses,
		Suspended:     before.Suspended,
	}, nil
}

func (store *Store) burySiblingCards(ctx context.Context, request ReviewRequest, reviewed Card,
	before ReviewStateSnapshot, preset SchedulerPreset) ([]Change, []string, error) {
	shouldBury := (before.State == "new" || before.State == "learning") && preset.BuryNewSiblings ||
		(before.State == "review" || before.State == "relearning") && preset.BuryReviewSiblings
	if !shouldBury {
		return nil, nil, nil
	}
	if request.BuryUntil <= request.ReviewedAt {
		return nil, nil, errors.New("sibling burial requires the next review day boundary")
	}
	siblings, err := store.projection.cardRevisionsBySource(ctx, reviewed.SourceID)
	if err != nil {
		return nil, nil, err
	}
	var changes []Change
	var buriedIDs []string
	for _, siblingRevision := range siblings {
		if siblingRevision.EntityID == reviewed.ID {
			continue
		}
		var sibling Card
		if err = decodeStrictJSON(siblingRevision.Payload, &sibling); err != nil {
			return nil, nil, err
		}
		if sibling.GenerationStatus != GenerationActive {
			continue
		}
		stateRevision, found, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, sibling.ID)
		if stateErr != nil {
			return nil, nil, stateErr
		}
		if !found || stateRevision.Deleted {
			return nil, nil, fmt.Errorf("sibling flashcard [%s] has no review state", sibling.ID)
		}
		var state ReviewState
		if stateErr = decodeStrictJSON(stateRevision.Payload, &state); stateErr != nil {
			return nil, nil, stateErr
		}
		if state.Suspended || state.BuriedUntil >= request.BuryUntil {
			continue
		}
		state.BuriedUntil = request.BuryUntil
		state.BuriedReason = "sibling"
		state.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, sibling.ID)
		revision, revisionErr := NewOperationEntityRevision(request.OperationID, EntityReviewState, sibling.ID,
			[]string{stateRevision.RevisionID}, request.ReviewedAt, false, state)
		if revisionErr != nil {
			return nil, nil, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
		buriedIDs = append(buriedIDs, sibling.ID)
	}
	return changes, buriedIDs, nil
}

func reviewResultFromBatch(batch OperationBatch, request ReviewRequest) (ReviewResult, error) {
	result := ReviewResult{Batch: batch}
	for _, change := range batch.Changes {
		switch change.Kind {
		case RecordEvent:
			if change.Event == nil || change.Event.EventType != EventReview {
				continue
			}
			var payload ReviewEventPayload
			if err := decodeStrictJSON(change.Event.Payload, &payload); err != nil {
				return ReviewResult{}, err
			}
			if payload.CardID != request.CardID || payload.Rating != request.Rating ||
				payload.ReviewedAt != request.ReviewedAt || payload.DurationMS == nil ||
				*payload.DurationMS != request.DurationMS || payload.SessionID != request.SessionID ||
				payload.ReviewSetID != request.ReviewSetID || payload.ReviewMode != request.ReviewMode {
				return ReviewResult{}, ErrOperationConflict
			}
			answerResult, err := canonicalOptionalReviewAnswer(request.AnswerResult)
			if err != nil || string(payload.AnswerResult) != string(answerResult) {
				return ReviewResult{}, ErrOperationConflict
			}
			var input schedulerInput
			if err := decodeStrictJSON(payload.SchedulerInput, &input); err != nil || input.BuryUntil != request.BuryUntil {
				return ReviewResult{}, ErrOperationConflict
			}
			result.Event = *change.Event
			if payload.BeforeState != nil {
				result.BeforeState = *payload.BeforeState
			}
			result.AfterState = payload.AfterState
			result.PresetRevisionID = payload.PresetRevisionID
			result.SchedulerVersion = payload.SchedulerVersion
		case RecordEntityRevision:
			if change.Revision == nil {
				continue
			}
			if change.Revision.EntityType == EntitySessionCard {
				var sessionCard SessionCard
				if err := decodeStrictJSON(change.Revision.Payload, &sessionCard); err != nil ||
					sessionCard.SessionID != request.SessionID {
					return ReviewResult{}, ErrOperationConflict
				}
				if sessionCard.CardID == request.CardID && sessionCard.Status == "reviewed" {
					result.SessionCard = &sessionCard
				} else if sessionCard.Status == "skipped" && sessionCard.SkipReason == "siblingBuried" {
					result.SkippedSessionCardIDs = append(result.SkippedSessionCardIDs, sessionCard.CardID)
				} else {
					return ReviewResult{}, ErrOperationConflict
				}
				continue
			}
			if change.Revision.EntityType == EntityTagAssignment && !change.Revision.Deleted {
				var assignment TagAssignment
				if err := decodeStrictJSON(change.Revision.Payload, &assignment); err != nil ||
					assignment.TagID != builtinLeechTagID || assignment.TargetType != "card" ||
					assignment.TargetID != request.CardID {
					return ReviewResult{}, ErrOperationConflict
				}
				result.LeechTagged = true
				continue
			}
			if change.Revision.EntityType != EntityReviewState || change.Revision.EntityID == request.CardID {
				continue
			}
			var state ReviewState
			if err := decodeStrictJSON(change.Revision.Payload, &state); err != nil {
				return ReviewResult{}, err
			}
			if state.BuriedReason == "sibling" {
				result.BuriedSiblingIDs = append(result.BuriedSiblingIDs, state.CardID)
			}
		}
	}
	if result.Event.EventID == "" {
		return ReviewResult{}, ErrOperationConflict
	}
	sort.Strings(result.SkippedSessionCardIDs)
	return result, nil
}

func toFSRSRating(rating ReviewRating) (fsrs.Rating, error) {
	switch rating {
	case ReviewAgain:
		return fsrs.Again, nil
	case ReviewHard:
		return fsrs.Hard, nil
	case ReviewGood:
		return fsrs.Good, nil
	case ReviewEasy:
		return fsrs.Easy, nil
	default:
		return 0, fmt.Errorf("unsupported flashcard review rating [%s]", rating)
	}
}

func toFSRSState(state string) (fsrs.State, error) {
	switch state {
	case "new":
		return fsrs.New, nil
	case "learning":
		return fsrs.Learning, nil
	case "review":
		return fsrs.Review, nil
	case "relearning":
		return fsrs.Relearning, nil
	default:
		return 0, fmt.Errorf("unsupported flashcard review state [%s]", state)
	}
}

func fromFSRSState(state fsrs.State) string {
	switch state {
	case fsrs.New:
		return "new"
	case fsrs.Learning:
		return "learning"
	case fsrs.Review:
		return "review"
	case fsrs.Relearning:
		return "relearning"
	default:
		panic(fmt.Sprintf("unsupported FSRS state [%d]", state))
	}
}

func millisToTime(value int64) time.Time {
	if value == 0 {
		return time.Time{}
	}
	return time.UnixMilli(value)
}
