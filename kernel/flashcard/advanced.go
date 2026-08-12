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
	AdvancedModeCloze          = "cloze"
	AdvancedModeOrderedSingle  = "orderedSingle"
	AdvancedModeOrderedCards   = "orderedCards"
	AdvancedModeImageOcclusion = "imageOcclusion"
	AdvancedModeChoiceSingle   = "choiceSingle"
	AdvancedModeChoiceMultiple = "choiceMultiple"
	AdvancedModeMultiLineAll   = "multiLineAll"
	AdvancedModeMultiLineSteps = "multiLineSteps"
	AdvancedModeTypedAnswer    = "typedAnswer"
)

var (
	advancedSchemaID                = DeterministicID("builtin", "advanced-text-schema")
	advancedClozeTemplateID         = DeterministicID("builtin", "advanced-cloze-template")
	advancedOrderedSingleTemplateID = DeterministicID("builtin", "advanced-ordered-single-template")
	advancedOrderedCardsTemplateID  = DeterministicID("builtin", "advanced-ordered-cards-template")
	advancedContentFieldID          = DeterministicID("builtin", "advanced-content-field")
	advancedImageSchemaID           = DeterministicID("builtin", "image-occlusion-schema")
	advancedImageTemplateID         = DeterministicID("builtin", "image-occlusion-template")
	advancedImageFieldID            = DeterministicID("builtin", "image-occlusion-field")
	advancedChoiceSchemaID          = DeterministicID("builtin", "choice-schema")
	advancedChoiceTemplateID        = DeterministicID("builtin", "choice-template")
	advancedChoiceFieldID           = DeterministicID("builtin", "choice-field")
	advancedMultiLineSchemaID       = DeterministicID("builtin", "multi-line-schema")
	advancedMultiLineTemplateID     = DeterministicID("builtin", "multi-line-template")
	advancedMultiLineFieldID        = DeterministicID("builtin", "multi-line-field")
	advancedTypedSchemaID           = DeterministicID("builtin", "typed-answer-schema")
	advancedTypedTemplateID         = DeterministicID("builtin", "typed-answer-template")
	advancedTypedFieldID            = DeterministicID("builtin", "typed-answer-field")
)

// AdvancedSourceRequest 由有序块创建分组挖空、单卡逐步揭示或递进式多卡。
type AdvancedSourceRequest struct {
	OperationID          string                    `json:"operationID"`
	SourceID             string                    `json:"sourceID"`
	Mode                 string                    `json:"mode"`
	BlockIDs             []string                  `json:"blockIDs"`
	ClozeGroups          []AdvancedClozeGroup      `json:"clozeGroups,omitempty"`
	InlineOcclusions     []AdvancedInlineOcclusion `json:"inlineOcclusions,omitempty"`
	ReviewSetIDs         []string                  `json:"reviewSetIDs,omitempty"`
	CreatedAt            int64                     `json:"createdAt"`
	ImageConfig          *ImageOcclusionConfig     `json:"imageConfig,omitempty"`
	CorrectOptionIndexes []int                     `json:"correctOptionIndexes,omitempty"`
	RandomizeOptions     bool                      `json:"randomizeOptions"`
	DistractorQuery      *QueryAST                 `json:"distractorQuery,omitempty"`
	DynamicDistractors   int                       `json:"dynamicDistractors,omitempty"`
	TypedConfig          *TypedAnswerConfig        `json:"typedConfig,omitempty"`
}

// AdvancedSourceUpdateRequest 描述对现有内置高级卡源的原子配置更新。
type AdvancedSourceUpdateRequest struct {
	OperationID          string                    `json:"operationID"`
	SourceID             string                    `json:"sourceID"`
	ExpectedRevision     string                    `json:"expectedRevisionID"`
	Mode                 string                    `json:"mode"`
	BlockIDs             []string                  `json:"blockIDs"`
	ClozeGroups          []AdvancedClozeGroup      `json:"clozeGroups,omitempty"`
	InlineOcclusions     []AdvancedInlineOcclusion `json:"inlineOcclusions,omitempty"`
	UpdatedAt            int64                     `json:"updatedAt"`
	ImageConfig          *ImageOcclusionConfig     `json:"imageConfig,omitempty"`
	CorrectOptionIndexes []int                     `json:"correctOptionIndexes,omitempty"`
	RandomizeOptions     bool                      `json:"randomizeOptions"`
	DistractorQuery      *QueryAST                 `json:"distractorQuery,omitempty"`
	DynamicDistractors   int                       `json:"dynamicDistractors,omitempty"`
	TypedConfig          *TypedAnswerConfig        `json:"typedConfig,omitempty"`
}

// TypedAnswerConfig 保存原生输入答案的声明式检查选项。
type TypedAnswerConfig struct {
	CaseSensitive      bool    `json:"caseSensitive"`
	IgnoreDiacritics   bool    `json:"ignoreDiacritics"`
	FuzzyMaxDistance   int     `json:"fuzzyMaxDistance,omitempty"`
	FuzzyMaxRatio      float64 `json:"fuzzyMaxRatio,omitempty"`
	TrimWhitespace     bool    `json:"trimWhitespace"`
	CollapseWhitespace bool    `json:"collapseWhitespace"`
}

func (config *TypedAnswerConfig) validate() error {
	if config == nil || config.FuzzyMaxDistance < 0 || config.FuzzyMaxDistance > 64 ||
		config.FuzzyMaxRatio < 0 || config.FuzzyMaxRatio > 1 {
		return errors.New("typed answer matching configuration is invalid")
	}
	return nil
}

// AdvancedClozeGroup 将一个有序分组映射到一个或多个挖空块。
type AdvancedClozeGroup struct {
	ID           string   `json:"id"`
	DisplayOrder int      `json:"displayOrder"`
	BlockIDs     []string `json:"blockIDs,omitempty"`
	OcclusionIDs []string `json:"occlusionIDs,omitempty"`
}

// AdvancedInlineOcclusion 将内容中的稳定文本标记映射到卡源挖空。
type AdvancedInlineOcclusion struct {
	ID           string `json:"id"`
	BlockID      string `json:"blockID"`
	DisplayOrder int    `json:"displayOrder"`
}

// AdvancedSourceResult 返回卡源、稳定生成卡和复习集成员关系。
type AdvancedSourceResult struct {
	SourceRevision EntityRevision  `json:"sourceRevision"`
	Cards          ReconcileResult `json:"cards"`
	Memberships    []string        `json:"memberships"`
}

// CreateAdvancedSource 将块顺序固化为显示顺序，将稳定派生 ID 用作挖空、分组和步骤身份。
func (store *Store) CreateAdvancedSource(ctx context.Context,
	request AdvancedSourceRequest) (AdvancedSourceResult, error) {
	if err := request.validate(); err != nil {
		return AdvancedSourceResult{}, err
	}
	if err := store.ensureAdvancedEntities(ctx); err != nil {
		return AdvancedSourceResult{}, err
	}
	source, references, template, err := buildAdvancedSource(request)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	variants, err := EnumerateCardVariants(source, template)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	mutations := make([]EntityMutation, 0, len(references)+1+len(variants)*2+
		len(request.ReviewSetIDs)*len(variants))
	for _, reference := range references {
		payload, payloadErr := CanonicalJSON(reference)
		if payloadErr != nil {
			return AdvancedSourceResult{}, payloadErr
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCardSourceRef, EntityID: reference.ID,
			RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: payload})
	}
	sourcePayload, err := CanonicalJSON(source)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	mutations = append(mutations, EntityMutation{EntityType: EntityCardSource, EntityID: source.ID,
		RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: sourcePayload})
	result := AdvancedSourceResult{
		Cards:       ReconcileResult{Created: make([]string, 0, len(variants))},
		Memberships: make([]string, 0, len(request.ReviewSetIDs)*len(variants)),
	}
	for _, variant := range variants {
		cardID := GeneratedCardID(source.ID, template.ID, variant.Key)
		card := Card{ID: cardID, SourceID: source.ID, TemplateID: template.ID, VariantKey: variant.Key,
			VariantData: variant.Data, GenerationStatus: GenerationActive, CreatedAt: request.CreatedAt,
			UpdatedAt: request.CreatedAt}
		cardPayload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return AdvancedSourceResult{}, payloadErr
		}
		state := ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{
			State: "new", Due: request.CreatedAt,
			StateRevisionID: OperationRevisionID(request.OperationID, EntityReviewState, cardID),
		}}
		statePayload, payloadErr := CanonicalJSON(state)
		if payloadErr != nil {
			return AdvancedSourceResult{}, payloadErr
		}
		mutations = append(mutations,
			EntityMutation{EntityType: EntityCard, EntityID: cardID, RequireAbsent: true,
				UpdatedAt: request.CreatedAt, Payload: cardPayload},
			EntityMutation{EntityType: EntityReviewState, EntityID: cardID, RequireAbsent: true,
				UpdatedAt: request.CreatedAt, Payload: statePayload})
		result.Cards.Created = append(result.Cards.Created, cardID)
	}
	for _, reviewSetID := range request.ReviewSetIDs {
		for _, cardID := range result.Cards.Created {
			membershipID := DeterministicID("advanced-review-set-membership", reviewSetID, cardID)
			membership := ReviewSetMembership{ID: membershipID, ReviewSetID: reviewSetID, CardID: cardID,
				Mode: MembershipInclude}
			payload, payloadErr := CanonicalJSON(membership)
			if payloadErr != nil {
				return AdvancedSourceResult{}, payloadErr
			}
			mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership,
				EntityID: membershipID, RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: payload})
			result.Memberships = append(result.Memberships, membershipID)
		}
	}
	mutationResult, err := store.MutateEntities(ctx, request.OperationID, mutations)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	for _, revision := range mutationResult.Revisions {
		if revision.EntityType == EntityCardSource {
			result.SourceRevision = revision
			break
		}
	}
	result.Cards.Batch = &mutationResult.Batch
	return result, nil
}

// UpdateAdvancedSource 在一个权威批次中更新卡源引用、配置和全部生成卡，保留稳定卡的排期与历史。
func (store *Store) UpdateAdvancedSource(ctx context.Context,
	request AdvancedSourceUpdateRequest) (AdvancedSourceResult, error) {
	if strings.TrimSpace(request.ExpectedRevision) == "" || request.UpdatedAt <= 0 {
		return AdvancedSourceResult{}, errors.New("advanced flashcard source update is invalid")
	}
	createRequest := request.createRequest()
	if err := createRequest.validate(); err != nil {
		return AdvancedSourceResult{}, err
	}
	if existing, found, err := store.findAppliedOperation(ctx, request.OperationID); err != nil {
		return AdvancedSourceResult{}, err
	} else if found {
		return advancedUpdateResultFromBatch(existing, request)
	}
	if err := store.ensureAdvancedEntities(ctx); err != nil {
		return AdvancedSourceResult{}, err
	}
	currentRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil || !found || currentRevision.Deleted {
		if err != nil {
			return AdvancedSourceResult{}, err
		}
		return AdvancedSourceResult{}, ErrEntityNotFound
	}
	if currentRevision.RevisionID != request.ExpectedRevision {
		return AdvancedSourceResult{}, ErrRevisionConflict
	}
	var currentSource CardSource
	if err = decodeStrictJSON(currentRevision.Payload, &currentSource); err != nil {
		return AdvancedSourceResult{}, err
	}
	if !isBuiltinAdvancedSource(currentSource) || currentSource.Status == "deleted" {
		return AdvancedSourceResult{}, errors.New("flashcard source is not an editable built-in advanced source")
	}
	source, references, template, err := buildAdvancedSource(createRequest)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	source.DefaultPresetID = currentSource.DefaultPresetID
	source.Priority = currentSource.Priority
	source.Status = currentSource.Status
	mutations, err := store.advancedReferenceMutations(ctx, request, references)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	sourcePayload, err := CanonicalJSON(source)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	mutations = append(mutations, EntityMutation{EntityType: EntityCardSource, EntityID: source.ID,
		ExpectedRevisionID: currentRevision.RevisionID, UpdatedAt: request.UpdatedAt, Payload: sourcePayload})
	cardMutations, cards, err := store.advancedCardMutations(ctx, request, source, template)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	mutations = append(mutations, cardMutations...)
	membershipMutations, membershipIDs, err := store.advancedMembershipMutations(ctx, request, cards.Created)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	mutations = append(mutations, membershipMutations...)
	mutationResult, err := store.MutateEntities(ctx, request.OperationID, mutations)
	if err != nil {
		return AdvancedSourceResult{}, err
	}
	result := AdvancedSourceResult{Cards: cards, Memberships: membershipIDs}
	result.Cards.Batch = &mutationResult.Batch
	for _, revision := range mutationResult.Revisions {
		if revision.EntityType == EntityCardSource {
			result.SourceRevision = revision
			break
		}
	}
	return result, nil
}

func (request AdvancedSourceUpdateRequest) createRequest() AdvancedSourceRequest {
	return AdvancedSourceRequest{
		OperationID: request.OperationID, SourceID: request.SourceID, Mode: request.Mode,
		BlockIDs: request.BlockIDs, ClozeGroups: request.ClozeGroups, InlineOcclusions: request.InlineOcclusions,
		CreatedAt: request.UpdatedAt, ImageConfig: request.ImageConfig,
		CorrectOptionIndexes: request.CorrectOptionIndexes, RandomizeOptions: request.RandomizeOptions,
		DistractorQuery: request.DistractorQuery, DynamicDistractors: request.DynamicDistractors,
		TypedConfig: request.TypedConfig,
	}
}

func isBuiltinAdvancedSource(source CardSource) bool {
	switch source.SchemaID {
	case advancedSchemaID, advancedImageSchemaID, advancedChoiceSchemaID, advancedMultiLineSchemaID,
		advancedTypedSchemaID:
		return true
	default:
		return false
	}
}

func (store *Store) advancedReferenceMutations(ctx context.Context, request AdvancedSourceUpdateRequest,
	references []CardSourceRef) ([]EntityMutation, error) {
	currentReferences, err := store.projection.CardSourceReferences(ctx, request.SourceID)
	if err != nil {
		return nil, err
	}
	desiredIDs := make(map[string]struct{}, len(references))
	mutations := make([]EntityMutation, 0, len(references)+len(currentReferences))
	for _, reference := range references {
		desiredIDs[reference.ID] = struct{}{}
		payload, payloadErr := CanonicalJSON(reference)
		if payloadErr != nil {
			return nil, payloadErr
		}
		current, found, queryErr := store.projection.CurrentEntity(ctx, EntityCardSourceRef, reference.ID)
		if queryErr != nil {
			return nil, queryErr
		}
		mutation := EntityMutation{EntityType: EntityCardSourceRef, EntityID: reference.ID,
			UpdatedAt: request.UpdatedAt, Payload: payload}
		if found {
			mutation.ExpectedRevisionID = current.RevisionID
			if !current.Deleted {
				var currentReference CardSourceRef
				if err = decodeStrictJSON(current.Payload, &currentReference); err != nil {
					return nil, err
				}
				if sameEntityPayload(currentReference, reference) {
					continue
				}
			}
		} else {
			mutation.RequireAbsent = true
		}
		mutations = append(mutations, mutation)
	}
	for _, reference := range currentReferences {
		if _, desired := desiredIDs[reference.ID]; desired {
			continue
		}
		current, found, queryErr := store.projection.CurrentEntity(ctx, EntityCardSourceRef, reference.ID)
		if queryErr != nil {
			return nil, queryErr
		}
		if !found || current.Deleted {
			continue
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCardSourceRef, EntityID: reference.ID,
			ExpectedRevisionID: current.RevisionID, UpdatedAt: request.UpdatedAt, Deleted: true,
			Payload: json.RawMessage(`{}`)})
	}
	return mutations, nil
}

func (store *Store) advancedCardMutations(ctx context.Context, request AdvancedSourceUpdateRequest,
	source CardSource, template CardTemplate) ([]EntityMutation, ReconcileResult, error) {
	variants, err := EnumerateCardVariants(source, template)
	if err != nil {
		return nil, ReconcileResult{}, err
	}
	existing, err := store.projection.cardRevisionsBySource(ctx, source.ID)
	if err != nil {
		return nil, ReconcileResult{}, err
	}
	existingByKey := make(map[string]EntityRevision, len(existing))
	for _, revision := range existing {
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			return nil, ReconcileResult{}, err
		}
		existingByKey[cardVariantMapKey(card.TemplateID, card.VariantKey)] = revision
	}
	status := GenerationActive
	if source.Status == "orphaned" {
		status = GenerationOrphaned
	}
	mutations := make([]EntityMutation, 0, len(variants)*2+len(existing))
	result := ReconcileResult{}
	for _, variant := range variants {
		key := cardVariantMapKey(template.ID, variant.Key)
		card := Card{ID: GeneratedCardID(source.ID, template.ID, variant.Key), SourceID: source.ID,
			TemplateID: template.ID, VariantKey: variant.Key, VariantData: variant.Data,
			GenerationStatus: status, CreatedAt: request.UpdatedAt, UpdatedAt: request.UpdatedAt}
		if revision, found := existingByKey[key]; found {
			var current Card
			if err = decodeStrictJSON(revision.Payload, &current); err != nil {
				return nil, ReconcileResult{}, err
			}
			card.ID, card.CreatedAt, card.Flag = current.ID, current.CreatedAt, current.Flag
			card.PresetOverrideID, card.PriorityOverride = current.PresetOverrideID, current.PriorityOverride
			state, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, card.ID)
			if stateErr != nil || !stateFound || state.Deleted {
				if stateErr != nil {
					return nil, ReconcileResult{}, stateErr
				}
				return nil, ReconcileResult{}, fmt.Errorf("flashcard [%s] has no active review state", card.ID)
			}
			card.UpdatedAt = current.UpdatedAt
			if sameEntityPayload(current, card) {
				result.Unchanged = append(result.Unchanged, card.ID)
				delete(existingByKey, key)
				continue
			}
			card.UpdatedAt = request.UpdatedAt
			payload, payloadErr := CanonicalJSON(card)
			if payloadErr != nil {
				return nil, ReconcileResult{}, payloadErr
			}
			mutations = append(mutations, EntityMutation{EntityType: EntityCard, EntityID: card.ID,
				ExpectedRevisionID: revision.RevisionID, UpdatedAt: request.UpdatedAt, Payload: payload})
			result.Updated = append(result.Updated, card.ID)
			delete(existingByKey, key)
			continue
		}
		_, priorFound, queryErr := store.projection.CurrentEntity(ctx, EntityCard, card.ID)
		if queryErr != nil {
			return nil, ReconcileResult{}, queryErr
		}
		if priorFound {
			return nil, ReconcileResult{}, fmt.Errorf("flashcard [%s] already exists outside its source", card.ID)
		}
		stateRevisionID := OperationRevisionID(request.OperationID, EntityReviewState, card.ID)
		state := ReviewState{CardID: card.ID, ReviewStateSnapshot: ReviewStateSnapshot{
			State: "new", Due: request.UpdatedAt, StateRevisionID: stateRevisionID}}
		cardPayload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return nil, ReconcileResult{}, payloadErr
		}
		statePayload, payloadErr := CanonicalJSON(state)
		if payloadErr != nil {
			return nil, ReconcileResult{}, payloadErr
		}
		mutations = append(mutations,
			EntityMutation{EntityType: EntityCard, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.UpdatedAt, Payload: cardPayload},
			EntityMutation{EntityType: EntityReviewState, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.UpdatedAt, Payload: statePayload})
		result.Created = append(result.Created, card.ID)
	}
	keys := make([]string, 0, len(existingByKey))
	for key := range existingByKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		revision := existingByKey[key]
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			return nil, ReconcileResult{}, err
		}
		if card.GenerationStatus == GenerationDeleted {
			result.Unchanged = append(result.Unchanged, card.ID)
			continue
		}
		card.GenerationStatus = GenerationDeleted
		card.UpdatedAt = request.UpdatedAt
		payload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return nil, ReconcileResult{}, payloadErr
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCard, EntityID: card.ID,
			ExpectedRevisionID: revision.RevisionID, UpdatedAt: request.UpdatedAt, Payload: payload})
		result.Updated = append(result.Updated, card.ID)
	}
	return mutations, result, nil
}

func (store *Store) advancedMembershipMutations(ctx context.Context, request AdvancedSourceUpdateRequest,
	cardIDs []string) ([]EntityMutation, []string, error) {
	if len(cardIDs) == 0 {
		return nil, nil, nil
	}
	reviewSetIDs, err := store.projection.advancedSourceReviewSetIDs(ctx, request.SourceID)
	if err != nil {
		return nil, nil, err
	}
	mutations := make([]EntityMutation, 0, len(reviewSetIDs)*len(cardIDs))
	membershipIDs := make([]string, 0, len(reviewSetIDs)*len(cardIDs))
	for _, reviewSetID := range reviewSetIDs {
		for _, cardID := range cardIDs {
			membershipID := DeterministicID("advanced-review-set-membership", reviewSetID, cardID)
			membership := ReviewSetMembership{ID: membershipID, ReviewSetID: reviewSetID, CardID: cardID,
				Mode: MembershipInclude}
			payload, payloadErr := CanonicalJSON(membership)
			if payloadErr != nil {
				return nil, nil, payloadErr
			}
			mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership,
				EntityID: membershipID, RequireAbsent: true, UpdatedAt: request.UpdatedAt, Payload: payload})
			membershipIDs = append(membershipIDs, membershipID)
		}
	}
	return mutations, membershipIDs, nil
}

func (projection *Projection) advancedSourceReviewSetIDs(ctx context.Context, sourceID string) ([]string, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT membership.id, membership.review_set_id,
		membership.card_id FROM review_set_memberships membership
		JOIN cards card ON card.id = membership.card_id
		JOIN review_sets review_set ON review_set.id = membership.review_set_id
		WHERE card.source_id = ? AND membership.mode = ?
		AND NOT EXISTS (SELECT 1 FROM entity_conflicts conflict WHERE conflict.entity_type = ?
			AND conflict.entity_id = membership.id AND conflict.resolved = 0)
		AND NOT EXISTS (SELECT 1 FROM entity_conflicts conflict WHERE conflict.entity_type = ?
			AND conflict.entity_id = card.id AND conflict.resolved = 0)
		AND NOT EXISTS (SELECT 1 FROM entity_conflicts conflict WHERE conflict.entity_type = ?
			AND conflict.entity_id = review_set.id AND conflict.resolved = 0)
		ORDER BY membership.review_set_id, membership.card_id`, sourceID, MembershipInclude,
		EntityReviewSetMembership, EntityCard, EntityReviewSet)
	if err != nil {
		return nil, fmt.Errorf("query advanced flashcard source review sets: %w", err)
	}
	defer rows.Close()
	seen := map[string]struct{}{}
	var reviewSetIDs []string
	for rows.Next() {
		var membershipID, reviewSetID, cardID string
		if err = rows.Scan(&membershipID, &reviewSetID, &cardID); err != nil {
			return nil, fmt.Errorf("scan advanced flashcard source review set: %w", err)
		}
		if membershipID != DeterministicID("advanced-review-set-membership", reviewSetID, cardID) {
			continue
		}
		if _, found := seen[reviewSetID]; found {
			continue
		}
		seen[reviewSetID] = struct{}{}
		reviewSetIDs = append(reviewSetIDs, reviewSetID)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate advanced flashcard source review sets: %w", err)
	}
	return reviewSetIDs, nil
}

func advancedUpdateResultFromBatch(batch OperationBatch,
	request AdvancedSourceUpdateRequest) (AdvancedSourceResult, error) {
	result := AdvancedSourceResult{Cards: ReconcileResult{Batch: &batch}}
	membershipCards := map[string]string{}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil ||
			change.Revision.UpdatedAt != request.UpdatedAt {
			return AdvancedSourceResult{}, ErrOperationConflict
		}
		revision := *change.Revision
		switch revision.EntityType {
		case EntityCardSource:
			if revision.EntityID != request.SourceID || result.SourceRevision.RevisionID != "" ||
				len(revision.ParentRevisionIDs) != 1 || revision.ParentRevisionIDs[0] != request.ExpectedRevision {
				return AdvancedSourceResult{}, ErrOperationConflict
			}
			result.SourceRevision = revision
		case EntityCard:
			var card Card
			if err := decodeStrictJSON(revision.Payload, &card); err != nil || card.SourceID != request.SourceID {
				return AdvancedSourceResult{}, ErrOperationConflict
			}
			if len(revision.ParentRevisionIDs) == 0 {
				result.Cards.Created = append(result.Cards.Created, card.ID)
			} else {
				result.Cards.Updated = append(result.Cards.Updated, card.ID)
			}
		case EntityReviewSetMembership:
			if revision.Deleted {
				return AdvancedSourceResult{}, ErrOperationConflict
			}
			var membership ReviewSetMembership
			if err := decodeStrictJSON(revision.Payload, &membership); err != nil ||
				membership.Mode != MembershipInclude || membership.ID != revision.EntityID ||
				revision.EntityID != DeterministicID("advanced-review-set-membership", membership.ReviewSetID,
					membership.CardID) {
				return AdvancedSourceResult{}, ErrOperationConflict
			}
			membershipCards[revision.EntityID] = membership.CardID
			result.Memberships = append(result.Memberships, revision.EntityID)
		case EntityCardSourceRef, EntityReviewState:
		default:
			return AdvancedSourceResult{}, ErrOperationConflict
		}
	}
	if result.SourceRevision.RevisionID == "" {
		return AdvancedSourceResult{}, ErrOperationConflict
	}
	createdCards := make(map[string]struct{}, len(result.Cards.Created))
	for _, cardID := range result.Cards.Created {
		createdCards[cardID] = struct{}{}
	}
	for _, cardID := range membershipCards {
		if _, found := createdCards[cardID]; !found {
			return AdvancedSourceResult{}, ErrOperationConflict
		}
	}
	return result, nil
}

func (request *AdvancedSourceRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SourceID) == "" ||
		request.CreatedAt <= 0 || len(request.BlockIDs) == 0 {
		return errors.New("advanced flashcard source requires an operation, source, blocks and time")
	}
	if request.Mode != AdvancedModeTypedAnswer && request.TypedConfig != nil {
		return errors.New("non-typed flashcard mode must not contain typed answer configuration")
	}
	switch request.Mode {
	case AdvancedModeCloze:
		if request.ImageConfig != nil || len(request.CorrectOptionIndexes) != 0 || request.DistractorQuery != nil ||
			request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("text flashcard mode must not contain image or choice configuration")
		}
		if err := validateAdvancedClozeGroups(request.BlockIDs, request.ClozeGroups); err != nil {
			return err
		}
		if err := validateAdvancedInlineOcclusions(request.BlockIDs, request.InlineOcclusions,
			request.ClozeGroups); err != nil {
			return err
		}
	case AdvancedModeOrderedSingle, AdvancedModeOrderedCards:
		if len(request.ClozeGroups) != 0 || request.ImageConfig != nil || len(request.CorrectOptionIndexes) != 0 ||
			request.DistractorQuery != nil || request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("ordered flashcard mode must not contain cloze, image or choice configuration")
		}
		if err := validateAdvancedInlineOcclusions(request.BlockIDs, request.InlineOcclusions, nil); err != nil {
			return err
		}
	case AdvancedModeImageOcclusion:
		if len(request.BlockIDs) != 1 || request.ImageConfig == nil || len(request.ClozeGroups) != 0 ||
			len(request.InlineOcclusions) != 0 {
			return errors.New("image occlusion requires exactly one image block and geometry configuration")
		}
		if err := request.ImageConfig.validate(); err != nil {
			return err
		}
		if len(request.CorrectOptionIndexes) != 0 || request.DistractorQuery != nil ||
			request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("image occlusion must not contain choice answers")
		}
	case AdvancedModeChoiceSingle, AdvancedModeChoiceMultiple:
		if len(request.BlockIDs) < 3 || request.ImageConfig != nil || len(request.ClozeGroups) != 0 ||
			len(request.InlineOcclusions) != 0 || len(request.CorrectOptionIndexes) == 0 {
			return errors.New("choice flashcard requires a question, at least two options, and a correct answer")
		}
		if request.Mode == AdvancedModeChoiceSingle && len(request.CorrectOptionIndexes) != 1 {
			return errors.New("single-choice flashcard requires exactly one correct answer")
		}
		seenIndexes := map[int]struct{}{}
		for _, index := range request.CorrectOptionIndexes {
			if index < 0 || index >= len(request.BlockIDs)-1 {
				return fmt.Errorf("flashcard correct option index [%d] is out of range", index)
			}
			if _, duplicate := seenIndexes[index]; duplicate {
				return fmt.Errorf("duplicate flashcard correct option index [%d]", index)
			}
			seenIndexes[index] = struct{}{}
		}
		if request.DynamicDistractors < 0 || request.DynamicDistractors > 50 ||
			(request.DynamicDistractors == 0) != (request.DistractorQuery == nil) {
			return errors.New("choice flashcard dynamic distractor configuration is invalid")
		}
		if request.DistractorQuery != nil {
			if err := request.DistractorQuery.Validate(); err != nil {
				return fmt.Errorf("validate choice flashcard distractor query: %w", err)
			}
		}
	case AdvancedModeMultiLineAll, AdvancedModeMultiLineSteps:
		if len(request.BlockIDs) < 2 || request.ImageConfig != nil || len(request.ClozeGroups) != 0 ||
			len(request.InlineOcclusions) != 0 ||
			len(request.CorrectOptionIndexes) != 0 || request.DistractorQuery != nil ||
			request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("multi-line flashcard requires a question and at least one answer")
		}
	case AdvancedModeTypedAnswer:
		if len(request.BlockIDs) < 2 || request.ImageConfig != nil || len(request.ClozeGroups) != 0 ||
			len(request.InlineOcclusions) != 0 ||
			len(request.CorrectOptionIndexes) != 0 || request.DistractorQuery != nil ||
			request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("typed answer flashcard requires a question and at least one answer")
		}
		if request.TypedConfig != nil {
			if err := request.TypedConfig.validate(); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("unsupported advanced flashcard mode [%s]", request.Mode)
	}
	if err := validateUniqueStrings("advanced flashcard block IDs", request.BlockIDs, false); err != nil {
		return err
	}
	return validateUniqueStrings("advanced flashcard review set IDs", request.ReviewSetIDs, false)
}

func validateAdvancedClozeGroups(blockIDs []string, groups []AdvancedClozeGroup) error {
	if len(groups) == 0 {
		return nil
	}
	available := make(map[string]struct{}, len(blockIDs))
	for _, blockID := range blockIDs {
		available[blockID] = struct{}{}
	}
	assigned := make(map[string]struct{}, len(blockIDs))
	groupIDs := map[string]struct{}{}
	orders := map[int]struct{}{}
	for _, group := range groups {
		if strings.TrimSpace(group.ID) == "" || group.DisplayOrder < 0 ||
			(len(group.BlockIDs) == 0) == (len(group.OcclusionIDs) == 0) {
			return errors.New("advanced cloze group identity, order and blocks are required")
		}
		if _, duplicate := groupIDs[group.ID]; duplicate {
			return fmt.Errorf("duplicate advanced cloze group [%s]", group.ID)
		}
		if _, duplicate := orders[group.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate advanced cloze group display order [%d]", group.DisplayOrder)
		}
		groupIDs[group.ID] = struct{}{}
		orders[group.DisplayOrder] = struct{}{}
		if len(group.OcclusionIDs) != 0 {
			if err := validateUniqueStrings("advanced cloze group occlusion IDs", group.OcclusionIDs, false); err != nil {
				return err
			}
			continue
		}
		seenBlocks := map[string]struct{}{}
		for _, blockID := range group.BlockIDs {
			if _, found := available[blockID]; !found {
				return fmt.Errorf("advanced cloze group references unknown block [%s]", blockID)
			}
			if _, duplicate := seenBlocks[blockID]; duplicate {
				return fmt.Errorf("advanced cloze group contains duplicate block [%s]", blockID)
			}
			seenBlocks[blockID] = struct{}{}
			assigned[blockID] = struct{}{}
		}
	}
	if len(groups) != 0 && len(groups[0].OcclusionIDs) != 0 {
		return nil
	}
	for _, blockID := range blockIDs {
		if _, found := assigned[blockID]; !found {
			return fmt.Errorf("advanced cloze block [%s] has no group", blockID)
		}
	}
	return nil
}

func validateAdvancedInlineOcclusions(blockIDs []string, occlusions []AdvancedInlineOcclusion,
	groups []AdvancedClozeGroup) error {
	if len(occlusions) == 0 {
		for _, group := range groups {
			if len(group.OcclusionIDs) != 0 {
				return errors.New("advanced cloze groups require inline occlusions")
			}
		}
		return nil
	}
	availableBlocks := stringSet(blockIDs)
	occlusionIDs := map[string]struct{}{}
	orders := map[int]struct{}{}
	for _, occlusion := range occlusions {
		if strings.TrimSpace(occlusion.ID) == "" || strings.TrimSpace(occlusion.BlockID) == "" ||
			occlusion.DisplayOrder < 0 {
			return errors.New("advanced inline occlusion identity, block and order are required")
		}
		if _, found := availableBlocks[occlusion.BlockID]; !found {
			return fmt.Errorf("advanced inline occlusion references unknown block [%s]", occlusion.BlockID)
		}
		if _, duplicate := occlusionIDs[occlusion.ID]; duplicate {
			return fmt.Errorf("duplicate advanced inline occlusion [%s]", occlusion.ID)
		}
		if _, duplicate := orders[occlusion.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate advanced inline occlusion display order [%d]", occlusion.DisplayOrder)
		}
		occlusionIDs[occlusion.ID] = struct{}{}
		orders[occlusion.DisplayOrder] = struct{}{}
	}
	if groups == nil {
		return nil
	}
	assigned := map[string]struct{}{}
	for _, group := range groups {
		if len(group.BlockIDs) != 0 || len(group.OcclusionIDs) == 0 {
			return errors.New("inline cloze groups must reference occlusion IDs")
		}
		for _, occlusionID := range group.OcclusionIDs {
			if _, found := occlusionIDs[occlusionID]; !found {
				return fmt.Errorf("advanced cloze group references unknown occlusion [%s]", occlusionID)
			}
			assigned[occlusionID] = struct{}{}
		}
	}
	if len(assigned) != len(occlusionIDs) {
		return errors.New("each advanced inline occlusion must belong to a cloze group")
	}
	return nil
}

func buildAdvancedSource(request AdvancedSourceRequest) (CardSource, []CardSourceRef, CardTemplate, error) {
	if request.Mode == AdvancedModeImageOcclusion {
		configJSON, err := CanonicalJSON(request.ImageConfig)
		if err != nil {
			return CardSource{}, nil, CardTemplate{}, err
		}
		reference := CardSourceRef{
			ID:       DeterministicID("image-occlusion-source-ref", request.SourceID, request.BlockIDs[0]),
			SourceID: request.SourceID, FieldID: advancedImageFieldID, EntityType: "block",
			EntityID: request.BlockIDs[0], Role: "image", Required: true,
		}
		source := CardSource{ID: request.SourceID, SchemaID: advancedImageSchemaID,
			SourceType: "image-occlusion", PrimaryRefID: reference.ID, DefaultPresetID: legacyPresetID,
			GenerationConfig: configJSON, Status: "active"}
		template, templateErr := advancedImageTemplate()
		return source, []CardSourceRef{reference}, template, templateErr
	}
	if request.Mode == AdvancedModeChoiceSingle || request.Mode == AdvancedModeChoiceMultiple {
		return buildAdvancedChoiceSource(request)
	}
	if request.Mode == AdvancedModeMultiLineAll || request.Mode == AdvancedModeMultiLineSteps {
		return buildAdvancedMultiLineSource(request)
	}
	if request.Mode == AdvancedModeTypedAnswer {
		return buildAdvancedTypedSource(request)
	}
	references := make([]CardSourceRef, 0, len(request.BlockIDs))
	occlusionIDs := make([]string, len(request.BlockIDs))
	for index, blockID := range request.BlockIDs {
		occlusionID := DeterministicID("advanced-occlusion", request.SourceID, blockID)
		occlusionIDs[index] = occlusionID
		role := "occlusion:" + occlusionID
		if len(request.InlineOcclusions) != 0 {
			role = "content"
		}
		references = append(references, CardSourceRef{
			ID: DeterministicID("advanced-card-source-ref", request.SourceID, blockID), SourceID: request.SourceID,
			FieldID: advancedContentFieldID, EntityType: "block", EntityID: blockID,
			Role: role, Sort: index, Required: true,
		})
	}
	templateID := advancedClozeTemplateID
	sourceType := "cloze"
	disabled := []string{advancedOrderedSingleTemplateID, advancedOrderedCardsTemplateID}
	var config any
	if request.Mode == AdvancedModeCloze {
		cloze := advancedClozeConfig(request, occlusionIDs)
		config = cloze
	} else {
		sourceType = "ordered"
		ordered := OrderedGenerationConfig{}
		if len(request.InlineOcclusions) == 0 {
			ordered.Steps = make([]OrderedStep, len(request.BlockIDs))
			for index, blockID := range request.BlockIDs {
				ordered.Steps[index] = OrderedStep{
					ID: DeterministicID("advanced-ordered-step", request.SourceID, blockID), DisplayOrder: index,
					OcclusionIDs: []string{occlusionIDs[index]}, RevealBehavior: "append",
				}
			}
		} else {
			ordered.Steps = make([]OrderedStep, len(request.InlineOcclusions))
			for index, occlusion := range request.InlineOcclusions {
				ordered.Steps[index] = OrderedStep{
					ID:           DeterministicID("advanced-ordered-step", request.SourceID, occlusion.ID),
					DisplayOrder: occlusion.DisplayOrder, OcclusionIDs: []string{occlusion.ID}, RevealBehavior: "append",
				}
			}
		}
		config = ordered
		if request.Mode == AdvancedModeOrderedSingle {
			templateID = advancedOrderedSingleTemplateID
			disabled = []string{advancedClozeTemplateID, advancedOrderedCardsTemplateID}
		} else {
			templateID = advancedOrderedCardsTemplateID
			disabled = []string{advancedClozeTemplateID, advancedOrderedSingleTemplateID}
		}
	}
	configJSON, err := CanonicalJSON(config)
	if err != nil {
		return CardSource{}, nil, CardTemplate{}, err
	}
	source := CardSource{ID: request.SourceID, SchemaID: advancedSchemaID, SourceType: sourceType,
		PrimaryRefID: references[0].ID, DefaultPresetID: legacyPresetID, GenerationConfig: configJSON,
		Status: "active", DisabledTemplateIDs: disabled}
	templates, err := advancedTemplates()
	if err != nil {
		return CardSource{}, nil, CardTemplate{}, err
	}
	for _, template := range templates {
		if template.ID == templateID {
			return source, references, template, nil
		}
	}
	return CardSource{}, nil, CardTemplate{}, errors.New("advanced flashcard template was not found")
}

func advancedClozeConfig(request AdvancedSourceRequest, occlusionIDs []string) ClozeGenerationConfig {
	if len(request.InlineOcclusions) != 0 {
		groupIDsByOcclusion := make(map[string][]string, len(request.InlineOcclusions))
		ret := ClozeGenerationConfig{Occlusions: make([]ClozeOcclusion, len(request.InlineOcclusions)),
			Groups: make([]ClozeGroup, len(request.ClozeGroups))}
		for index, group := range request.ClozeGroups {
			ret.Groups[index] = ClozeGroup{ID: group.ID, DisplayOrder: group.DisplayOrder}
			for _, occlusionID := range group.OcclusionIDs {
				groupIDsByOcclusion[occlusionID] = append(groupIDsByOcclusion[occlusionID], group.ID)
			}
		}
		for index, occlusion := range request.InlineOcclusions {
			ret.Occlusions[index] = ClozeOcclusion{ID: occlusion.ID,
				GroupIDs: groupIDsByOcclusion[occlusion.ID], DisplayOrder: occlusion.DisplayOrder}
		}
		return ret
	}
	ret := ClozeGenerationConfig{Occlusions: make([]ClozeOcclusion, len(request.BlockIDs))}
	if len(request.ClozeGroups) == 0 {
		ret.Groups = make([]ClozeGroup, len(request.BlockIDs))
		for index, blockID := range request.BlockIDs {
			groupID := DeterministicID("advanced-cloze-group", request.SourceID, blockID)
			ret.Occlusions[index] = ClozeOcclusion{ID: occlusionIDs[index], GroupIDs: []string{groupID},
				DisplayOrder: index}
			ret.Groups[index] = ClozeGroup{ID: groupID, DisplayOrder: index}
		}
		return ret
	}
	groupIDsByBlock := make(map[string][]string, len(request.BlockIDs))
	ret.Groups = make([]ClozeGroup, len(request.ClozeGroups))
	for index, group := range request.ClozeGroups {
		ret.Groups[index] = ClozeGroup{ID: group.ID, DisplayOrder: group.DisplayOrder}
		for _, blockID := range group.BlockIDs {
			groupIDsByBlock[blockID] = append(groupIDsByBlock[blockID], group.ID)
		}
	}
	for index, blockID := range request.BlockIDs {
		ret.Occlusions[index] = ClozeOcclusion{ID: occlusionIDs[index], GroupIDs: groupIDsByBlock[blockID],
			DisplayOrder: index}
	}
	return ret
}

func buildAdvancedChoiceSource(request AdvancedSourceRequest) (CardSource, []CardSourceRef, CardTemplate, error) {
	references := make([]CardSourceRef, 0, len(request.BlockIDs))
	questionID := request.BlockIDs[0]
	references = append(references, CardSourceRef{
		ID:       DeterministicID("choice-source-ref", request.SourceID, "question", questionID),
		SourceID: request.SourceID, FieldID: advancedChoiceFieldID, EntityType: "block", EntityID: questionID,
		Role: "question", Required: true,
	})
	options := make([]ChoiceOption, 0, len(request.BlockIDs)-1)
	correctIndexes := map[int]struct{}{}
	for _, index := range request.CorrectOptionIndexes {
		correctIndexes[index] = struct{}{}
	}
	correctOptionIDs := make([]string, 0, len(correctIndexes))
	for index, blockID := range request.BlockIDs[1:] {
		optionID := DeterministicID("choice-option", request.SourceID, blockID)
		options = append(options, ChoiceOption{ID: optionID, DisplayOrder: index})
		references = append(references, CardSourceRef{
			ID:       DeterministicID("choice-source-ref", request.SourceID, "option", blockID),
			SourceID: request.SourceID, FieldID: advancedChoiceFieldID, EntityType: "block", EntityID: blockID,
			Role: "option:" + optionID, Sort: index + 1, Required: true,
		})
		if _, correct := correctIndexes[index]; correct {
			correctOptionIDs = append(correctOptionIDs, optionID)
		}
	}
	mode := "single"
	if request.Mode == AdvancedModeChoiceMultiple {
		mode = "multiple"
	}
	config := ChoiceGenerationConfig{Mode: mode, Options: options, CorrectOptionIDs: correctOptionIDs,
		Randomize: request.RandomizeOptions, DistractorQuery: request.DistractorQuery,
		DynamicDistractorCount: request.DynamicDistractors}
	configJSON, err := CanonicalJSON(config)
	if err != nil {
		return CardSource{}, nil, CardTemplate{}, err
	}
	source := CardSource{ID: request.SourceID, SchemaID: advancedChoiceSchemaID, SourceType: "choice",
		PrimaryRefID: references[0].ID, DefaultPresetID: legacyPresetID, GenerationConfig: configJSON,
		Status: "active"}
	template, err := advancedChoiceTemplate()
	return source, references, template, err
}

func buildAdvancedMultiLineSource(request AdvancedSourceRequest) (CardSource, []CardSourceRef, CardTemplate, error) {
	references := make([]CardSourceRef, 0, len(request.BlockIDs))
	questionID := request.BlockIDs[0]
	references = append(references, CardSourceRef{
		ID:       DeterministicID("multi-line-source-ref", request.SourceID, "question", questionID),
		SourceID: request.SourceID, FieldID: advancedMultiLineFieldID, EntityType: "block", EntityID: questionID,
		Role: "question", Required: true,
	})
	answers := make([]MultiLineAnswer, 0, len(request.BlockIDs)-1)
	for index, blockID := range request.BlockIDs[1:] {
		answerID := DeterministicID("multi-line-answer", request.SourceID, blockID)
		answers = append(answers, MultiLineAnswer{ID: answerID, DisplayOrder: index})
		references = append(references, CardSourceRef{
			ID:       DeterministicID("multi-line-source-ref", request.SourceID, "answer", blockID),
			SourceID: request.SourceID, FieldID: advancedMultiLineFieldID, EntityType: "block", EntityID: blockID,
			Role: "answer:" + answerID, Sort: index + 1, Required: true,
		})
	}
	revealMode := "all"
	if request.Mode == AdvancedModeMultiLineSteps {
		revealMode = "steps"
	}
	configJSON, err := CanonicalJSON(MultiLineGenerationConfig{Answers: answers, RevealMode: revealMode})
	if err != nil {
		return CardSource{}, nil, CardTemplate{}, err
	}
	source := CardSource{ID: request.SourceID, SchemaID: advancedMultiLineSchemaID, SourceType: "multi-line",
		PrimaryRefID: references[0].ID, DefaultPresetID: legacyPresetID, GenerationConfig: configJSON,
		Status: "active"}
	template, err := advancedMultiLineTemplate()
	return source, references, template, err
}

func buildAdvancedTypedSource(request AdvancedSourceRequest) (CardSource, []CardSourceRef, CardTemplate, error) {
	references := make([]CardSourceRef, 0, len(request.BlockIDs))
	references = append(references, CardSourceRef{
		ID:       DeterministicID("typed-answer-source-ref", request.SourceID, "question", request.BlockIDs[0]),
		SourceID: request.SourceID, FieldID: advancedTypedFieldID, EntityType: "block",
		EntityID: request.BlockIDs[0], Role: "question", Required: true,
	})
	for index, blockID := range request.BlockIDs[1:] {
		answerID := DeterministicID("typed-answer", request.SourceID, blockID)
		references = append(references, CardSourceRef{
			ID:       DeterministicID("typed-answer-source-ref", request.SourceID, "answer", blockID),
			SourceID: request.SourceID, FieldID: advancedTypedFieldID, EntityType: "block", EntityID: blockID,
			Role: "answer:" + answerID, Sort: index + 1, Required: true,
		})
	}
	config := TypedAnswerConfig{FuzzyMaxRatio: 0.1, TrimWhitespace: true, CollapseWhitespace: true}
	if request.TypedConfig != nil {
		config = *request.TypedConfig
	}
	configJSON, err := CanonicalJSON(config)
	if err != nil {
		return CardSource{}, nil, CardTemplate{}, err
	}
	source := CardSource{ID: request.SourceID, SchemaID: advancedTypedSchemaID, SourceType: "typed-answer",
		PrimaryRefID: references[0].ID, DefaultPresetID: legacyPresetID, GenerationConfig: configJSON,
		Status: "active"}
	template, err := advancedTypedTemplate()
	return source, references, template, err
}

func (store *Store) ensureAdvancedEntities(ctx context.Context) error {
	values, err := advancedEntityPayloads()
	if err != nil {
		return err
	}
	missing := make([]EntityMutation, 0, len(values))
	missingIDs := make([]string, 0, len(values))
	for _, value := range values {
		current, found, queryErr := store.projection.CurrentEntity(ctx, value.EntityType, value.EntityID)
		if queryErr != nil {
			return queryErr
		}
		if found && !current.Deleted {
			upgrade, upgradeErr := prepareBuiltinEntityMutation(current, &value)
			if upgradeErr != nil {
				return upgradeErr
			}
			if !upgrade {
				continue
			}
		} else if found {
			value.ExpectedRevisionID = current.RevisionID
		}
		missing = append(missing, value)
		missingIDs = append(missingIDs, value.EntityID)
	}
	if len(missing) == 0 {
		return nil
	}
	sort.Strings(missingIDs)
	identityParts := append([]string(nil), missingIDs...)
	for _, mutation := range missing {
		identityParts = append(identityParts, mutation.ExpectedRevisionID)
	}
	_, err = store.MutateEntities(ctx, "builtin-advanced-v2:"+DeterministicID("missing", identityParts...), missing)
	return err
}

func advancedEntityPayloads() ([]EntityMutation, error) {
	templates, err := advancedTemplates()
	if err != nil {
		return nil, err
	}
	schema := CardSchema{ID: advancedSchemaID, Name: "Advanced text", BuiltinType: "advanced-text",
		Fields: []CardSchemaField{{ID: advancedContentFieldID, Name: "Content", Type: "block", Required: true}},
		TemplateIDs: []string{advancedClozeTemplateID, advancedOrderedSingleTemplateID,
			advancedOrderedCardsTemplateID}}
	imageTemplate, err := advancedImageTemplate()
	if err != nil {
		return nil, err
	}
	imageSchema := CardSchema{ID: advancedImageSchemaID, Name: "Image occlusion", BuiltinType: "image-occlusion",
		Fields:      []CardSchemaField{{ID: advancedImageFieldID, Name: "Image", Type: "block", Required: true}},
		TemplateIDs: []string{advancedImageTemplateID}}
	choiceTemplate, err := advancedChoiceTemplate()
	if err != nil {
		return nil, err
	}
	choiceSchema := CardSchema{ID: advancedChoiceSchemaID, Name: "Choice", BuiltinType: "choice",
		Fields:      []CardSchemaField{{ID: advancedChoiceFieldID, Name: "Content", Type: "block", Required: true}},
		TemplateIDs: []string{advancedChoiceTemplateID}}
	multiLineTemplate, err := advancedMultiLineTemplate()
	if err != nil {
		return nil, err
	}
	multiLineSchema := CardSchema{ID: advancedMultiLineSchemaID, Name: "Multi-line", BuiltinType: "multi-line",
		Fields:      []CardSchemaField{{ID: advancedMultiLineFieldID, Name: "Content", Type: "block", Required: true}},
		TemplateIDs: []string{advancedMultiLineTemplateID}}
	typedTemplate, err := advancedTypedTemplate()
	if err != nil {
		return nil, err
	}
	typedSchema := CardSchema{ID: advancedTypedSchemaID, Name: "Typed answer", BuiltinType: "typed-answer",
		Fields:      []CardSchemaField{{ID: advancedTypedFieldID, Name: "Content", Type: "block", Required: true}},
		TemplateIDs: []string{advancedTypedTemplateID}}
	items := []struct {
		entityType EntityType
		entityID   string
		payload    any
	}{{EntityCardSchema, schema.ID, schema}, {EntityCardSchema, imageSchema.ID, imageSchema},
		{EntityCardTemplate, imageTemplate.ID, imageTemplate}, {EntityCardSchema, choiceSchema.ID, choiceSchema},
		{EntityCardTemplate, choiceTemplate.ID, choiceTemplate},
		{EntityCardSchema, multiLineSchema.ID, multiLineSchema},
		{EntityCardTemplate, multiLineTemplate.ID, multiLineTemplate},
		{EntityCardSchema, typedSchema.ID, typedSchema}, {EntityCardTemplate, typedTemplate.ID, typedTemplate}}
	for _, template := range templates {
		items = append(items, struct {
			entityType EntityType
			entityID   string
			payload    any
		}{EntityCardTemplate, template.ID, template})
	}
	ret := make([]EntityMutation, 0, len(items))
	for _, item := range items {
		payload, payloadErr := CanonicalJSON(item.payload)
		if payloadErr != nil {
			return nil, payloadErr
		}
		ret = append(ret, EntityMutation{EntityType: item.entityType, EntityID: item.entityID, Payload: payload})
	}
	return ret, nil
}

func advancedImageTemplate() (CardTemplate, error) {
	spec, err := CanonicalJSON(map[string]any{"fieldID": advancedImageFieldID, "type": "field"})
	if err != nil {
		return CardTemplate{}, err
	}
	return CardTemplate{ID: advancedImageTemplateID, SchemaID: advancedImageSchemaID, Name: "Image occlusion",
		GenerationRule: json.RawMessage(`{"mode":"imageGroups"}`), FrontSpec: spec, BackSpec: spec,
		AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true}, nil
}

func advancedChoiceTemplate() (CardTemplate, error) {
	spec, err := CanonicalJSON(map[string]any{"type": "choice"})
	if err != nil {
		return CardTemplate{}, err
	}
	return CardTemplate{ID: advancedChoiceTemplateID, SchemaID: advancedChoiceSchemaID, Name: "Choice",
		GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"choice"}`), FrontSpec: spec,
		BackSpec: spec, AnswerMode: "choice", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true}, nil
}

func advancedMultiLineTemplate() (CardTemplate, error) {
	spec, err := CanonicalJSON(map[string]any{"type": "multi-line"})
	if err != nil {
		return CardTemplate{}, err
	}
	return CardTemplate{ID: advancedMultiLineTemplateID, SchemaID: advancedMultiLineSchemaID, Name: "Multi-line",
		GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"multi-line"}`), FrontSpec: spec,
		BackSpec: spec, AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true}, nil
}

func advancedTypedTemplate() (CardTemplate, error) {
	front, err := CanonicalJSON(map[string]any{"type": "field", "role": "question"})
	if err != nil {
		return CardTemplate{}, err
	}
	back, err := CanonicalJSON(map[string]any{"type": "field", "fieldID": advancedTypedFieldID})
	if err != nil {
		return CardTemplate{}, err
	}
	return CardTemplate{ID: advancedTypedTemplateID, SchemaID: advancedTypedSchemaID, Name: "Typed answer",
		GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"typed"}`), FrontSpec: front,
		BackSpec: back, AnswerMode: "typed", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true}, nil
}

func advancedTemplates() ([]CardTemplate, error) {
	spec := json.RawMessage(`{"fieldID":"` + advancedContentFieldID + `","type":"field"}`)
	return []CardTemplate{
		{ID: advancedClozeTemplateID, SchemaID: advancedSchemaID, Name: "Cloze",
			GenerationRule: json.RawMessage(`{"mode":"clozeGroups"}`), FrontSpec: spec, BackSpec: spec,
			AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true},
		{ID: advancedOrderedSingleTemplateID, SchemaID: advancedSchemaID, Name: "Ordered single",
			GenerationRule: json.RawMessage(`{"mode":"orderedSingle","variantKey":"ordered"}`), FrontSpec: spec,
			BackSpec: spec, AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true},
		{ID: advancedOrderedCardsTemplateID, SchemaID: advancedSchemaID, Name: "Ordered cards",
			GenerationRule: json.RawMessage(`{"mode":"orderedCards"}`), FrontSpec: spec, BackSpec: spec,
			AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true},
	}, nil
}
