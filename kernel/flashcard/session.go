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

// StudyQueueRequest 保存启动复习会话时冻结的范围、模式和限制。
type StudyQueueRequest struct {
	OperationID      string                                `json:"operationID"`
	SessionID        string                                `json:"sessionID"`
	ReviewSetID      string                                `json:"reviewSetID,omitempty"`
	Query            *QueryAST                             `json:"query,omitempty"`
	ReviewMode       string                                `json:"reviewMode,omitempty"`
	Seed             string                                `json:"seed,omitempty"`
	Now              int64                                 `json:"now"`
	NewLimit         int                                   `json:"newLimit"`
	ReviewLimit      int                                   `json:"reviewLimit"`
	IncludeSuspended bool                                  `json:"includeSuspended"`
	IncludeBuried    bool                                  `json:"includeBuried"`
	IncludePaused    bool                                  `json:"includePaused"`
	ValidateCardIDs  func(context.Context, []string) error `json:"-"`
	ValidateBlockIDs func([]string) error                  `json:"-"`
}

// StudyQueueResult 返回持久化的会话与稳定卡片顺序。
type StudyQueueResult struct {
	Batch        OperationBatch `json:"batch"`
	Session      StudySession   `json:"session"`
	SessionCards []SessionCard  `json:"sessionCards"`
}

// SessionQueueCard 返回会话位置与当前卡片、排期状态。
type SessionQueueCard struct {
	SessionCard SessionCard `json:"sessionCard"`
	Card        Card        `json:"card"`
	ReviewState ReviewState `json:"reviewState"`
}

// SessionCardUpdateRequest 描述跳过、展示或恢复一张会话卡片。
type SessionCardUpdateRequest struct {
	OperationID string `json:"operationID"`
	SessionID   string `json:"sessionID"`
	CardID      string `json:"cardID"`
	Status      string `json:"status"`
	SkipReason  string `json:"skipReason,omitempty"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// FinishSessionRequest 描述完成或放弃一个复习会话。
type FinishSessionRequest struct {
	OperationID string `json:"operationID"`
	SessionID   string `json:"sessionID"`
	Status      string `json:"status"`
	EndedAt     int64  `json:"endedAt"`
}

// StartStudySession 计算一次稳定队列，并把队列快照与会话放在同一权威批次中。
func (store *Store) StartStudySession(ctx context.Context, request StudyQueueRequest) (StudyQueueResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return StudyQueueResult{}, errors.New("flashcard store is closed")
	}
	if err := request.validate(); err != nil {
		return StudyQueueResult{}, err
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return StudyQueueResult{}, err
	} else if found {
		result, resultErr := studyQueueResultFromBatch(existing, request)
		if resultErr != nil {
			return StudyQueueResult{}, resultErr
		}
		if request.ValidateCardIDs != nil {
			cardIDs := make([]string, len(result.SessionCards))
			for index := range result.SessionCards {
				cardIDs[index] = result.SessionCards[index].CardID
			}
			if resultErr = request.ValidateCardIDs(ctx, cardIDs); resultErr != nil {
				return StudyQueueResult{}, resultErr
			}
		}
		if request.ValidateBlockIDs != nil {
			blockIDs := make([]string, 0)
			for _, sessionCard := range result.SessionCards {
				for _, option := range sessionCard.DynamicOptions {
					blockIDs = append(blockIDs, option.EntityID)
				}
			}
			if resultErr = request.ValidateBlockIDs(blockIDs); resultErr != nil {
				return StudyQueueResult{}, resultErr
			}
		}
		return result, nil
	}
	if _, found, err := store.projection.CurrentEntity(ctx, EntityStudySession, request.SessionID); err != nil {
		return StudyQueueResult{}, err
	} else if found {
		return StudyQueueResult{}, errors.New("flashcard study session already exists")
	}

	mode := request.ReviewMode
	newLimit := request.NewLimit
	reviewLimit := request.ReviewLimit
	reviewSetOrder := ReviewSetOrder{Mode: ReviewSetOrderPriorityDue}
	var queryJSON json.RawMessage
	if request.Query != nil {
		data, err := CanonicalJSON(request.Query)
		if err != nil {
			return StudyQueueResult{}, err
		}
		queryJSON = data
	}
	if request.ReviewSetID != "" {
		setRevision, found, queryErr := store.projection.CurrentEntity(ctx, EntityReviewSet, request.ReviewSetID)
		if queryErr != nil {
			return StudyQueueResult{}, queryErr
		}
		if !found || setRevision.Deleted {
			return StudyQueueResult{}, errors.New("flashcard review set was not found")
		}
		var reviewSet ReviewSet
		if queryErr = decodeStrictJSON(setRevision.Payload, &reviewSet); queryErr != nil {
			return StudyQueueResult{}, queryErr
		}
		if mode == "" {
			mode = reviewSet.DefaultReviewMode
		}
		reviewSetOrder, queryErr = parseReviewSetOrder(reviewSet.Order)
		if queryErr != nil {
			return StudyQueueResult{}, queryErr
		}
		newLimit = reviewSet.NewLimit
		reviewLimit = reviewSet.ReviewLimit
	}
	if mode == "" {
		mode = "normal"
	}
	if mode != "normal" && mode != "reinforcement" {
		return StudyQueueResult{}, fmt.Errorf("unsupported flashcard review mode [%s]", mode)
	}
	if mode == "normal" && (request.IncludeSuspended || request.IncludeBuried || request.IncludePaused) {
		return StudyQueueResult{}, errors.New("normal flashcard review cannot include paused, suspended or buried cards")
	}
	options := CardSearchOptions{Now: request.Now}
	if mode == "reinforcement" {
		options.IncludeSuspended = request.IncludeSuspended
		options.IncludeBuried = request.IncludeBuried
		options.IncludePaused = request.IncludePaused
	}
	results, err := store.projection.SearchCards(ctx, request.Query, options)
	if err != nil {
		return StudyQueueResult{}, err
	}
	if request.ReviewSetID != "" {
		memberIDs, memberErr := store.projection.ReviewSetCardIDs(ctx, request.ReviewSetID, options)
		if memberErr != nil {
			return StudyQueueResult{}, memberErr
		}
		members := make(map[string]struct{}, len(memberIDs))
		for _, cardID := range memberIDs {
			members[cardID] = struct{}{}
		}
		filtered := results[:0]
		for _, result := range results {
			if _, included := members[result.Card.ID]; included {
				filtered = append(filtered, result)
			}
		}
		results = filtered
	}
	if mode == "normal" {
		filtered := results[:0]
		for _, result := range results {
			if result.ReviewState.Due <= request.Now {
				filtered = append(filtered, result)
			}
		}
		results = filtered
	}
	seed := request.Seed
	if seed == "" {
		seed = request.SessionID
	}
	sortStudyQueue(results, reviewSetOrder, seed)
	selected := limitStudyQueue(results, newLimit, reviewLimit)
	cardIDs := make([]string, len(selected))
	for index := range selected {
		cardIDs[index] = selected[index].Card.ID
	}
	if request.ValidateCardIDs != nil {
		if err = request.ValidateCardIDs(ctx, cardIDs); err != nil {
			return StudyQueueResult{}, err
		}
	}
	selectionDigest, err := checksum(cardIDs)
	if err != nil {
		return StudyQueueResult{}, err
	}
	session := StudySession{
		ID: request.SessionID, ReviewSetID: request.ReviewSetID, QueryAST: queryJSON, ReviewMode: mode,
		Status: "active", Seed: seed, NewLimit: newLimit, ReviewLimit: reviewLimit,
		IncludeSuspended: request.IncludeSuspended, IncludeBuried: request.IncludeBuried,
		IncludePaused: request.IncludePaused, SelectionDigest: selectionDigest, StartedAt: request.Now,
	}
	sessionRevision, err := NewOperationEntityRevision(request.OperationID, EntityStudySession, session.ID, nil,
		request.Now, false, session)
	if err != nil {
		return StudyQueueResult{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &sessionRevision}}
	sessionCards := make([]SessionCard, 0, len(selected))
	for index, result := range selected {
		optionOrder, dynamicOptions, optionErr := store.sessionCardChoiceOptions(ctx, result.Card, seed, request.Now)
		if optionErr != nil {
			return StudyQueueResult{}, optionErr
		}
		if request.ValidateBlockIDs != nil {
			blockIDs := make([]string, len(dynamicOptions))
			for optionIndex, option := range dynamicOptions {
				blockIDs[optionIndex] = option.EntityID
			}
			if optionErr = request.ValidateBlockIDs(blockIDs); optionErr != nil {
				return StudyQueueResult{}, optionErr
			}
		}
		sessionCard := SessionCard{
			ID: DeterministicID("session-card", session.ID, result.Card.ID), SessionID: session.ID,
			CardID: result.Card.ID, StateRevisionID: result.ReviewState.StateRevisionID,
			Sort: index, Status: "queued", OptionOrder: optionOrder,
			DynamicOptions: dynamicOptions,
		}
		revision, revisionErr := NewOperationEntityRevision(request.OperationID, EntitySessionCard, sessionCard.ID, nil,
			request.Now, false, sessionCard)
		if revisionErr != nil {
			return StudyQueueResult{}, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
		sessionCards = append(sessionCards, sessionCard)
	}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return StudyQueueResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return StudyQueueResult{}, err
	}
	return StudyQueueResult{Batch: batch, Session: session, SessionCards: sessionCards}, nil
}

func (store *Store) sessionCardChoiceOptions(ctx context.Context, card Card, seed string,
	now int64) ([]string, []SessionChoiceOption, error) {
	sourceRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, card.SourceID)
	if err != nil {
		return nil, nil, err
	}
	if !found || sourceRevision.Deleted {
		return nil, nil, errors.New("flashcard session source was not found")
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		return nil, nil, err
	}
	if source.SourceType != "choice" {
		return nil, nil, nil
	}
	var config ChoiceGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		return nil, nil, err
	}
	if err = config.validate(); err != nil {
		return nil, nil, err
	}
	dynamicOptions, err := store.dynamicChoiceOptions(ctx, card, source, config, seed, now)
	if err != nil {
		return nil, nil, err
	}
	orderConfig := config
	orderConfig.DistractorQuery = nil
	orderConfig.DynamicDistractorCount = 0
	orderConfig.Options = append([]ChoiceOption(nil), config.Options...)
	for index, option := range dynamicOptions {
		orderConfig.Options = append(orderConfig.Options,
			ChoiceOption{ID: option.ID, DisplayOrder: len(config.Options) + index})
	}
	order, err := ChoiceOptionOrder(orderConfig, seed, card.ID)
	return order, dynamicOptions, err
}

func (store *Store) dynamicChoiceOptions(ctx context.Context, card Card, source CardSource,
	config ChoiceGenerationConfig, seed string, now int64) ([]SessionChoiceOption, error) {
	if config.DynamicDistractorCount == 0 {
		return nil, nil
	}
	compiled, err := compileQueryExpression(&config.DistractorQuery.Root, now)
	if err != nil {
		return nil, err
	}
	where := []string{"(" + compiled.sql + ")", "c.generation_status = ?", "c.source_id <> ?", `NOT EXISTS (
		SELECT 1 FROM entity_conflicts ec WHERE ec.resolved = 0 AND (
			(ec.entity_type IN (?, ?) AND ec.entity_id = c.id) OR
			(ec.entity_type = ? AND ec.entity_id = c.source_id) OR
			(ec.entity_type = ? AND ec.entity_id = c.template_id) OR
			(ec.entity_type = ? AND ec.entity_id = s.schema_id)))`, sourceAvailableSQL + " = 1"}
	args := append([]any(nil), compiled.args...)
	args = append(args, GenerationActive, source.ID, EntityCard, EntityReviewState, EntityCardSource,
		EntityCardTemplate, EntityCardSchema)
	excluded := map[string]struct{}{}
	references, err := store.projection.CardSourceReferences(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	for _, reference := range references {
		if reference.EntityType == "block" {
			excluded[reference.EntityID] = struct{}{}
		}
	}
	rows, err := store.projection.db.QueryContext(ctx, `SELECT MIN(c.id), r.entity_id
		FROM cards c
		JOIN review_states rs ON rs.card_id = c.id
		JOIN card_sources s ON s.id = c.source_id
		JOIN card_source_refs r ON r.id = s.primary_ref_id AND r.entity_type = 'block'
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY r.entity_id ORDER BY r.entity_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("query dynamic flashcard distractors: %w", err)
	}
	defer rows.Close()
	type candidate struct {
		option SessionChoiceOption
		score  string
	}
	selected := make([]candidate, 0, config.DynamicDistractorCount)
	for rows.Next() {
		var candidateCardID, blockID string
		if err = rows.Scan(&candidateCardID, &blockID); err != nil {
			return nil, fmt.Errorf("scan dynamic flashcard distractor: %w", err)
		}
		if _, found := excluded[blockID]; found {
			continue
		}
		value := candidate{option: SessionChoiceOption{
			ID: DeterministicID("dynamic-choice-option", card.ID, blockID), EntityType: "block", EntityID: blockID,
		}, score: DeterministicID("dynamic-choice-order", seed, card.ID, candidateCardID, blockID)}
		if len(selected) < config.DynamicDistractorCount {
			selected = append(selected, value)
			continue
		}
		maximum := 0
		for index := 1; index < len(selected); index++ {
			if selected[index].score > selected[maximum].score {
				maximum = index
			}
		}
		if value.score < selected[maximum].score {
			selected[maximum] = value
		}
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate dynamic flashcard distractors: %w", err)
	}
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].score != selected[j].score {
			return selected[i].score < selected[j].score
		}
		return selected[i].option.ID < selected[j].option.ID
	})
	ret := make([]SessionChoiceOption, len(selected))
	for index, value := range selected {
		ret[index] = value.option
	}
	return ret, nil
}

// ChoiceOptionOrder 返回一次会话中稳定的选择题选项顺序。
func ChoiceOptionOrder(config ChoiceGenerationConfig, seed, cardID string) ([]string, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	options := append([]ChoiceOption(nil), config.Options...)
	if config.Randomize {
		sort.Slice(options, func(i, j int) bool {
			left := DeterministicID("choice-option-order", seed, cardID, options[i].ID)
			right := DeterministicID("choice-option-order", seed, cardID, options[j].ID)
			if left != right {
				return left < right
			}
			return options[i].ID < options[j].ID
		})
	} else {
		sort.Slice(options, func(i, j int) bool {
			if options[i].DisplayOrder != options[j].DisplayOrder {
				return options[i].DisplayOrder < options[j].DisplayOrder
			}
			return options[i].ID < options[j].ID
		})
	}
	ret := make([]string, len(options))
	for index, option := range options {
		ret[index] = option.ID
	}
	return ret, nil
}

func (request *StudyQueueRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SessionID) == "" || request.Now <= 0 ||
		request.NewLimit < 0 || request.ReviewLimit < 0 {
		return errors.New("flashcard study queue identity, time and limits are invalid")
	}
	if request.Query != nil {
		if request.ReviewSetID != "" {
			return errors.New("flashcard study queue cannot combine a review set with an ad hoc query")
		}
		if err := request.Query.Validate(); err != nil {
			return err
		}
	}
	if request.ReviewMode != "" && request.ReviewMode != "normal" && request.ReviewMode != "reinforcement" {
		return fmt.Errorf("unsupported flashcard review mode [%s]", request.ReviewMode)
	}
	if request.ReviewSetID == "" && request.ReviewMode != "reinforcement" &&
		(request.IncludeSuspended || request.IncludeBuried || request.IncludePaused) {
		return errors.New("normal flashcard review cannot include paused, suspended or buried cards")
	}
	return nil
}

func effectiveQueuePriority(result CardSearchResult) int {
	switch result.EffectivePriority {
	case "exam":
		return 0
	case "learning":
		return 1
	case "retaining":
		return 2
	default:
		return 3
	}
}

func sortStudyQueue(results []CardSearchResult, order ReviewSetOrder, seed string) {
	sort.Slice(results, func(i, j int) bool {
		left := results[i]
		right := results[j]
		switch order.Mode {
		case ReviewSetOrderDue:
			if left.ReviewState.Due != right.ReviewState.Due {
				return left.ReviewState.Due < right.ReviewState.Due
			}
		case ReviewSetOrderAdded:
			if left.Card.CreatedAt != right.Card.CreatedAt {
				return left.Card.CreatedAt < right.Card.CreatedAt
			}
		case ReviewSetOrderRandom:
			leftScore := DeterministicID("study-queue-order", seed, left.Card.ID)
			rightScore := DeterministicID("study-queue-order", seed, right.Card.ID)
			if leftScore != rightScore {
				return leftScore < rightScore
			}
		default:
			leftPriority := effectiveQueuePriority(left)
			rightPriority := effectiveQueuePriority(right)
			if leftPriority != rightPriority {
				return leftPriority < rightPriority
			}
			if left.ReviewState.Due != right.ReviewState.Due {
				return left.ReviewState.Due < right.ReviewState.Due
			}
		}
		return left.Card.ID < right.Card.ID
	})
}

func limitStudyQueue(results []CardSearchResult, newLimit, reviewLimit int) []CardSearchResult {
	ret := make([]CardSearchResult, 0, len(results))
	newCount := 0
	reviewCount := 0
	for _, result := range results {
		if result.ReviewState.State == "new" {
			if newCount >= newLimit {
				continue
			}
			newCount++
		} else {
			if reviewCount >= reviewLimit {
				continue
			}
			reviewCount++
		}
		ret = append(ret, result)
	}
	return ret
}

func studyQueueResultFromBatch(batch OperationBatch, request StudyQueueRequest) (StudyQueueResult, error) {
	result := StudyQueueResult{Batch: batch}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil || change.Revision.Deleted {
			return StudyQueueResult{}, ErrOperationConflict
		}
		switch change.Revision.EntityType {
		case EntityStudySession:
			if result.Session.ID != "" || decodeStrictJSON(change.Revision.Payload, &result.Session) != nil {
				return StudyQueueResult{}, ErrOperationConflict
			}
		case EntitySessionCard:
			var sessionCard SessionCard
			if err := decodeStrictJSON(change.Revision.Payload, &sessionCard); err != nil {
				return StudyQueueResult{}, ErrOperationConflict
			}
			result.SessionCards = append(result.SessionCards, sessionCard)
		default:
			return StudyQueueResult{}, ErrOperationConflict
		}
	}
	seed := request.Seed
	if seed == "" {
		seed = request.SessionID
	}
	if result.Session.ID != request.SessionID || result.Session.ReviewSetID != request.ReviewSetID ||
		result.Session.StartedAt != request.Now || result.Session.Seed != seed {
		return StudyQueueResult{}, ErrOperationConflict
	}
	if request.ReviewMode != "" && result.Session.ReviewMode != request.ReviewMode {
		return StudyQueueResult{}, ErrOperationConflict
	}
	if result.Session.IncludeSuspended != request.IncludeSuspended ||
		result.Session.IncludeBuried != request.IncludeBuried || result.Session.IncludePaused != request.IncludePaused {
		return StudyQueueResult{}, ErrOperationConflict
	}
	if request.ReviewSetID == "" &&
		(result.Session.NewLimit != request.NewLimit || result.Session.ReviewLimit != request.ReviewLimit) {
		return StudyQueueResult{}, ErrOperationConflict
	}
	if request.Query != nil {
		queryJSON, err := CanonicalJSON(request.Query)
		if err != nil || string(queryJSON) != string(result.Session.QueryAST) {
			return StudyQueueResult{}, ErrOperationConflict
		}
	}
	sort.Slice(result.SessionCards, func(i, j int) bool { return result.SessionCards[i].Sort < result.SessionCards[j].Sort })
	cardIDs := make([]string, len(result.SessionCards))
	for index := range result.SessionCards {
		cardIDs[index] = result.SessionCards[index].CardID
	}
	digest, err := checksum(cardIDs)
	if err != nil || digest != result.Session.SelectionDigest {
		return StudyQueueResult{}, ErrOperationConflict
	}
	return result, nil
}

// SessionQueue 返回会话被冻结的稳定顺序和卡片当前状态。
func (projection *Projection) SessionQueue(ctx context.Context, sessionID string) ([]SessionQueueCard, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT sce.payload, ce.payload, rse.payload,
		COALESCE(availability.available, 1)
		FROM session_cards sc
		JOIN entities sce ON sce.entity_type = ? AND sce.entity_id = sc.id AND sce.deleted = 0
		JOIN entities ce ON ce.entity_type = ? AND ce.entity_id = sc.card_id AND ce.deleted = 0
		JOIN entities rse ON rse.entity_type = ? AND rse.entity_id = sc.card_id AND rse.deleted = 0
		JOIN cards card ON card.id = sc.card_id
		LEFT JOIN source_availability availability ON availability.source_id = card.source_id
		WHERE sc.session_id = ? ORDER BY sc.sort, sc.id`, EntitySessionCard, EntityCard, EntityReviewState, sessionID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard study session queue: %w", err)
	}
	defer rows.Close()
	ret := make([]SessionQueueCard, 0)
	for rows.Next() {
		var sessionPayload, cardPayload, statePayload []byte
		var sourceAvailable bool
		var result SessionQueueCard
		if err = rows.Scan(&sessionPayload, &cardPayload, &statePayload, &sourceAvailable); err != nil {
			return nil, fmt.Errorf("scan flashcard study session queue: %w", err)
		}
		if err = decodeStrictJSON(sessionPayload, &result.SessionCard); err != nil {
			return nil, err
		}
		if err = decodeStrictJSON(cardPayload, &result.Card); err != nil {
			return nil, err
		}
		if !sourceAvailable && result.Card.GenerationStatus == GenerationActive {
			result.Card.GenerationStatus = GenerationOrphaned
		}
		if err = decodeStrictJSON(statePayload, &result.ReviewState); err != nil {
			return nil, err
		}
		ret = append(ret, result)
	}
	return ret, rows.Err()
}

// UpdateSessionCard 更新会话中的展示或跳过状态，不修改正常排期。
func (store *Store) UpdateSessionCard(ctx context.Context, request SessionCardUpdateRequest) (SessionCard, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return SessionCard{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SessionID) == "" ||
		strings.TrimSpace(request.CardID) == "" || request.UpdatedAt <= 0 ||
		(request.Status != "queued" && request.Status != "shown" && request.Status != "skipped") {
		return SessionCard{}, errors.New("flashcard session card update is invalid")
	}
	if request.Status == "skipped" && strings.TrimSpace(request.SkipReason) == "" {
		return SessionCard{}, errors.New("skipped flashcard requires a reason")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return SessionCard{}, err
	} else if found {
		return sessionCardFromBatch(existing, request)
	}
	if err := store.requireActiveSession(ctx, request.SessionID, "", ""); err != nil {
		return SessionCard{}, err
	}
	entityID := DeterministicID("session-card", request.SessionID, request.CardID)
	current, found, err := store.projection.CurrentEntity(ctx, EntitySessionCard, entityID)
	if err != nil {
		return SessionCard{}, err
	}
	if !found || current.Deleted {
		return SessionCard{}, ErrEntityNotFound
	}
	var sessionCard SessionCard
	if err = decodeStrictJSON(current.Payload, &sessionCard); err != nil {
		return SessionCard{}, err
	}
	if sessionCard.Status == "reviewed" {
		return SessionCard{}, errors.New("reviewed flashcard cannot be changed to another session state")
	}
	sessionCard.Status = request.Status
	sessionCard.SkipReason = request.SkipReason
	if request.Status != "skipped" {
		sessionCard.SkipReason = ""
	}
	revision, err := NewOperationEntityRevision(request.OperationID, EntitySessionCard, entityID,
		[]string{current.RevisionID}, request.UpdatedAt, false, sessionCard)
	if err != nil {
		return SessionCard{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID,
		[]Change{{Kind: RecordEntityRevision, Revision: &revision}})
	if err != nil {
		return SessionCard{}, err
	}
	return sessionCardFromBatch(batch, request)
}

func sessionCardFromBatch(batch OperationBatch, request SessionCardUpdateRequest) (SessionCard, error) {
	if len(batch.Changes) != 1 || batch.Changes[0].Kind != RecordEntityRevision ||
		batch.Changes[0].Revision == nil || batch.Changes[0].Revision.EntityType != EntitySessionCard ||
		batch.Changes[0].Revision.UpdatedAt != request.UpdatedAt {
		return SessionCard{}, ErrOperationConflict
	}
	var sessionCard SessionCard
	if err := decodeStrictJSON(batch.Changes[0].Revision.Payload, &sessionCard); err != nil {
		return SessionCard{}, ErrOperationConflict
	}
	if sessionCard.SessionID != request.SessionID || sessionCard.CardID != request.CardID ||
		sessionCard.Status != request.Status || sessionCard.SkipReason != request.SkipReason {
		return SessionCard{}, ErrOperationConflict
	}
	return sessionCard, nil
}

// FinishStudySession 将活动会话标记为已完成或已放弃。
func (store *Store) FinishStudySession(ctx context.Context, request FinishSessionRequest) (StudySession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return StudySession{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SessionID) == "" ||
		(request.Status != "completed" && request.Status != "abandoned") || request.EndedAt <= 0 {
		return StudySession{}, errors.New("flashcard study session finish request is invalid")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return StudySession{}, err
	} else if found {
		return finishedSessionFromBatch(existing, request)
	}
	current, found, err := store.projection.CurrentEntity(ctx, EntityStudySession, request.SessionID)
	if err != nil {
		return StudySession{}, err
	}
	if !found || current.Deleted {
		return StudySession{}, ErrEntityNotFound
	}
	var session StudySession
	if err = decodeStrictJSON(current.Payload, &session); err != nil {
		return StudySession{}, err
	}
	if session.Status != "active" {
		return StudySession{}, errors.New("flashcard study session is not active")
	}
	session.Status = request.Status
	session.EndedAt = &request.EndedAt
	revision, err := NewOperationEntityRevision(request.OperationID, EntityStudySession, session.ID,
		[]string{current.RevisionID}, request.EndedAt, false, session)
	if err != nil {
		return StudySession{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &revision}}
	if request.Status == "completed" {
		pending, pendingErr := store.projection.sessionCardRevisions(ctx, request.SessionID)
		if pendingErr != nil {
			return StudySession{}, pendingErr
		}
		for _, value := range pending {
			if value.Card.Status != "queued" && value.Card.Status != "shown" {
				continue
			}
			value.Card.Status = "skipped"
			value.Card.SkipReason = "session-completed"
			cardRevision, revisionErr := NewOperationEntityRevision(request.OperationID, EntitySessionCard,
				value.Card.ID, []string{value.RevisionID}, request.EndedAt, false, value.Card)
			if revisionErr != nil {
				return StudySession{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &cardRevision})
		}
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return StudySession{}, err
	}
	return finishedSessionFromBatch(batch, request)
}

func finishedSessionFromBatch(batch OperationBatch, request FinishSessionRequest) (StudySession, error) {
	var session StudySession
	found := false
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil || change.Revision.Deleted {
			return StudySession{}, ErrOperationConflict
		}
		switch change.Revision.EntityType {
		case EntityStudySession:
			if found || decodeStrictJSON(change.Revision.Payload, &session) != nil {
				return StudySession{}, ErrOperationConflict
			}
			found = true
		case EntitySessionCard:
			var sessionCard SessionCard
			if decodeStrictJSON(change.Revision.Payload, &sessionCard) != nil ||
				sessionCard.SessionID != request.SessionID || sessionCard.Status != "skipped" ||
				sessionCard.SkipReason != "session-completed" {
				return StudySession{}, ErrOperationConflict
			}
		default:
			return StudySession{}, ErrOperationConflict
		}
	}
	if !found || session.ID != request.SessionID || session.Status != request.Status || session.EndedAt == nil ||
		*session.EndedAt != request.EndedAt {
		return StudySession{}, ErrOperationConflict
	}
	return session, nil
}

type sessionCardRevision struct {
	RevisionID string
	Card       SessionCard
}

func (projection *Projection) sessionCardRevisions(ctx context.Context,
	sessionID string) ([]sessionCardRevision, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT entity.revision_id, entity.payload
		FROM session_cards session_card
		JOIN entities entity ON entity.entity_type = ? AND entity.entity_id = session_card.id AND entity.deleted = 0
		WHERE session_card.session_id = ? ORDER BY session_card.sort, session_card.id`, EntitySessionCard, sessionID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard session card revisions: %w", err)
	}
	defer rows.Close()
	var ret []sessionCardRevision
	for rows.Next() {
		var value sessionCardRevision
		var payload []byte
		if err = rows.Scan(&value.RevisionID, &payload); err != nil {
			return nil, fmt.Errorf("scan flashcard session card revision: %w", err)
		}
		if err = decodeStrictJSON(payload, &value.Card); err != nil {
			return nil, err
		}
		ret = append(ret, value)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard session card revisions: %w", err)
	}
	return ret, nil
}

func (store *Store) requireActiveSession(ctx context.Context, sessionID, reviewSetID, reviewMode string) error {
	revision, found, err := store.projection.CurrentEntity(ctx, EntityStudySession, sessionID)
	if err != nil {
		return err
	}
	if !found || revision.Deleted {
		return ErrEntityNotFound
	}
	var session StudySession
	if err = decodeStrictJSON(revision.Payload, &session); err != nil {
		return err
	}
	if session.Status != "active" {
		return errors.New("flashcard study session is not active")
	}
	if reviewMode != "" && (session.ReviewMode != reviewMode || session.ReviewSetID != reviewSetID) {
		return errors.New("flashcard review scope does not match the study session")
	}
	return nil
}
