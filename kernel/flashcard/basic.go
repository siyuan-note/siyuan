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

const (
	BasicDirectionForward       = "forward"
	BasicDirectionReverse       = "reverse"
	BasicDirectionBidirectional = "bidirectional"
	BasicDirectionClosed        = "closed"
)

var (
	basicSchemaID          = DeterministicID("builtin", "basic-qa-schema")
	basicForwardTemplateID = DeterministicID("builtin", "basic-qa-forward-template")
	basicReverseTemplateID = DeterministicID("builtin", "basic-qa-reverse-template")
	basicPromptFieldID     = DeterministicID("builtin", "basic-qa-prompt-field")
	basicAnswerFieldID     = DeterministicID("builtin", "basic-qa-answer-field")
)

// BasicSourceRequest 描述由有序块引用创建的普通问答卡源。
type BasicSourceRequest struct {
	OperationID  string   `json:"operationID"`
	SourceID     string   `json:"sourceID"`
	BlockIDs     []string `json:"blockIDs"`
	Direction    string   `json:"direction"`
	ReviewSetIDs []string `json:"reviewSetIDs,omitempty"`
	CreatedAt    int64    `json:"createdAt"`
}

// BasicSourceResult 返回卡源修订和由方向生成的独立卡片。
type BasicSourceResult struct {
	SourceRevision EntityRevision  `json:"sourceRevision"`
	Cards          ReconcileResult `json:"cards"`
	Memberships    []string        `json:"memberships"`
}

// BasicDirectionRequest 描述普通问答卡源的方向切换。
type BasicDirectionRequest struct {
	OperationID      string `json:"operationID"`
	SourceID         string `json:"sourceID"`
	Direction        string `json:"direction"`
	ExpectedRevision string `json:"expectedRevision,omitempty"`
	UpdatedAt        int64  `json:"updatedAt"`
}

// CreateBasicSource 创建一个以首块为问题、其余有序块为答案的普通卡源。
func (store *Store) CreateBasicSource(ctx context.Context, request BasicSourceRequest) (BasicSourceResult, error) {
	if err := request.validate(); err != nil {
		return BasicSourceResult{}, err
	}
	if err := store.ensureBasicEntities(ctx); err != nil {
		return BasicSourceResult{}, err
	}
	refs := make([]CardSourceRef, 0, len(request.BlockIDs))
	cardIDs := basicCardIDs(request.SourceID)
	activeCardIDs := stringSet(basicActiveCardIDs(request.SourceID, request.Direction))
	mutations := make([]EntityMutation, 0, len(request.BlockIDs)+1+len(cardIDs)*2+
		len(request.ReviewSetIDs)*len(cardIDs))
	for index, blockID := range request.BlockIDs {
		fieldID := basicAnswerFieldID
		role := "back"
		if index == 0 {
			fieldID = basicPromptFieldID
			role = "front"
		}
		ref := CardSourceRef{
			ID: DeterministicID("basic-card-source-ref", request.SourceID, fieldID, blockID), SourceID: request.SourceID,
			FieldID: fieldID, EntityType: "block", EntityID: blockID, Role: role, Sort: index, Required: true,
		}
		refs = append(refs, ref)
		payload, err := CanonicalJSON(ref)
		if err != nil {
			return BasicSourceResult{}, err
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCardSourceRef, EntityID: ref.ID,
			RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: payload})
	}
	source := CardSource{
		ID: request.SourceID, SchemaID: basicSchemaID, SourceType: "qa", PrimaryRefID: refs[0].ID,
		DefaultPresetID: legacyPresetID, GenerationConfig: json.RawMessage(`{"type":"basic"}`), Status: "active",
		DisabledTemplateIDs: basicDisabledTemplates(request.Direction),
	}
	sourcePayload, err := CanonicalJSON(source)
	if err != nil {
		return BasicSourceResult{}, err
	}
	mutations = append(mutations, EntityMutation{EntityType: EntityCardSource, EntityID: source.ID,
		RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: sourcePayload})
	for _, cardID := range cardIDs {
		templateID, variantKey := basicCardIdentity(cardID, source.ID)
		generationStatus := GenerationDisabledByTemplate
		if _, active := activeCardIDs[cardID]; active {
			generationStatus = GenerationActive
		}
		card := Card{ID: cardID, SourceID: source.ID, TemplateID: templateID, VariantKey: variantKey,
			VariantData: json.RawMessage(`{"mode":"static"}`), GenerationStatus: generationStatus,
			CreatedAt: request.CreatedAt, UpdatedAt: request.CreatedAt}
		cardPayload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return BasicSourceResult{}, payloadErr
		}
		stateRevisionID := OperationRevisionID(request.OperationID, EntityReviewState, card.ID)
		state := ReviewState{CardID: card.ID, ReviewStateSnapshot: ReviewStateSnapshot{
			State: "new", Due: request.CreatedAt, StateRevisionID: stateRevisionID,
		}}
		statePayload, payloadErr := CanonicalJSON(state)
		if payloadErr != nil {
			return BasicSourceResult{}, payloadErr
		}
		mutations = append(mutations,
			EntityMutation{EntityType: EntityCard, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.CreatedAt, Payload: cardPayload},
			EntityMutation{EntityType: EntityReviewState, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.CreatedAt, Payload: statePayload})
	}
	result := BasicSourceResult{Memberships: make([]string, 0, len(request.ReviewSetIDs)*len(cardIDs))}
	if len(request.ReviewSetIDs) != 0 {
		for _, reviewSetID := range request.ReviewSetIDs {
			for _, cardID := range cardIDs {
				membershipID := DeterministicID("basic-review-set-membership", reviewSetID, cardID)
				membership := ReviewSetMembership{ID: membershipID, ReviewSetID: reviewSetID, CardID: cardID,
					Mode: MembershipInclude}
				payload, payloadErr := CanonicalJSON(membership)
				if payloadErr != nil {
					return BasicSourceResult{}, payloadErr
				}
				mutations = append(mutations, EntityMutation{EntityType: EntityReviewSetMembership,
					EntityID: membershipID, RequireAbsent: true, UpdatedAt: request.CreatedAt, Payload: payload})
				result.Memberships = append(result.Memberships, membershipID)
			}
		}
	}
	mutationResult, err := store.MutateEntities(ctx, request.OperationID, mutations)
	if err != nil {
		return BasicSourceResult{}, err
	}
	for _, revision := range mutationResult.Revisions {
		if revision.EntityType == EntityCardSource {
			result.SourceRevision = revision
			break
		}
	}
	result.Cards = ReconcileResult{Batch: &mutationResult.Batch, Created: cardIDs}
	return result, nil
}

func basicCardIdentity(cardID, sourceID string) (templateID, variantKey string) {
	forwardID := GeneratedCardID(sourceID, basicForwardTemplateID, BasicDirectionForward)
	if cardID == forwardID {
		return basicForwardTemplateID, BasicDirectionForward
	}
	return basicReverseTemplateID, BasicDirectionReverse
}

// UpdateBasicSourceDirection 切换普通问答方向，关闭的卡保留身份、排期和历史。
func (store *Store) UpdateBasicSourceDirection(ctx context.Context,
	request BasicDirectionRequest) (BasicSourceResult, error) {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SourceID) == "" ||
		request.UpdatedAt <= 0 {
		return BasicSourceResult{}, errors.New("basic flashcard direction update is invalid")
	}
	if len(basicDisabledTemplates(request.Direction)) == 0 && request.Direction != BasicDirectionBidirectional {
		return BasicSourceResult{}, fmt.Errorf("unsupported basic flashcard direction [%s]", request.Direction)
	}
	if err := store.ensureBasicEntities(ctx); err != nil {
		return BasicSourceResult{}, err
	}
	if existing, found, err := store.findAppliedOperation(ctx, request.OperationID); err != nil {
		return BasicSourceResult{}, err
	} else if found {
		return basicDirectionResultFromBatch(existing, request)
	}
	current, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil || !found || current.Deleted {
		if err != nil {
			return BasicSourceResult{}, err
		}
		return BasicSourceResult{}, ErrEntityNotFound
	}
	if request.ExpectedRevision != "" && request.ExpectedRevision != current.RevisionID {
		return BasicSourceResult{}, ErrRevisionConflict
	}
	var source CardSource
	if err = decodeStrictJSON(current.Payload, &source); err != nil {
		return BasicSourceResult{}, err
	}
	if source.SchemaID != basicSchemaID || source.SourceType != "qa" {
		return BasicSourceResult{}, errors.New("flashcard source is not a built-in basic source")
	}
	source.DisabledTemplateIDs = basicDisabledTemplates(request.Direction)
	payload, err := CanonicalJSON(source)
	if err != nil {
		return BasicSourceResult{}, err
	}
	mutations := []EntityMutation{{
		EntityType: EntityCardSource, EntityID: source.ID, ExpectedRevisionID: current.RevisionID,
		UpdatedAt: request.UpdatedAt, Payload: payload,
	}}
	result := BasicSourceResult{}
	activeCardIDs := stringSet(basicActiveCardIDs(source.ID, request.Direction))
	for _, cardID := range basicCardIDs(source.ID) {
		desiredStatus := GenerationDisabledByTemplate
		if _, active := activeCardIDs[cardID]; active {
			desiredStatus = GenerationActive
		}
		cardRevision, cardFound, queryErr := store.projection.CurrentEntity(ctx, EntityCard, cardID)
		if queryErr != nil {
			return BasicSourceResult{}, queryErr
		}
		if cardFound && cardRevision.Deleted {
			result.Cards.Unchanged = append(result.Cards.Unchanged, cardID)
			continue
		}
		if cardFound {
			var card Card
			if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
				return BasicSourceResult{}, err
			}
			templateID, variantKey := basicCardIdentity(cardID, source.ID)
			if card.SourceID != source.ID || card.TemplateID != templateID || card.VariantKey != variantKey {
				return BasicSourceResult{}, errors.New("built-in basic flashcard identity is invalid")
			}
			stateRevision, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
			if stateErr != nil {
				return BasicSourceResult{}, stateErr
			}
			if !stateFound || stateRevision.Deleted {
				return BasicSourceResult{}, fmt.Errorf("flashcard [%s] has no active review state", cardID)
			}
			if card.GenerationStatus == desiredStatus {
				result.Cards.Unchanged = append(result.Cards.Unchanged, cardID)
				continue
			}
			card.GenerationStatus = desiredStatus
			card.UpdatedAt = request.UpdatedAt
			cardPayload, payloadErr := CanonicalJSON(card)
			if payloadErr != nil {
				return BasicSourceResult{}, payloadErr
			}
			mutations = append(mutations, EntityMutation{EntityType: EntityCard, EntityID: card.ID,
				ExpectedRevisionID: cardRevision.RevisionID, UpdatedAt: request.UpdatedAt, Payload: cardPayload})
			result.Cards.Updated = append(result.Cards.Updated, cardID)
			continue
		}
		templateID, variantKey := basicCardIdentity(cardID, source.ID)
		card := Card{ID: cardID, SourceID: source.ID, TemplateID: templateID, VariantKey: variantKey,
			VariantData: json.RawMessage(`{"mode":"static"}`), GenerationStatus: desiredStatus,
			CreatedAt: request.UpdatedAt, UpdatedAt: request.UpdatedAt}
		cardPayload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return BasicSourceResult{}, payloadErr
		}
		stateRevisionID := OperationRevisionID(request.OperationID, EntityReviewState, card.ID)
		state := ReviewState{CardID: card.ID, ReviewStateSnapshot: ReviewStateSnapshot{
			State: "new", Due: request.UpdatedAt, StateRevisionID: stateRevisionID,
		}}
		statePayload, payloadErr := CanonicalJSON(state)
		if payloadErr != nil {
			return BasicSourceResult{}, payloadErr
		}
		mutations = append(mutations,
			EntityMutation{EntityType: EntityCard, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.UpdatedAt, Payload: cardPayload},
			EntityMutation{EntityType: EntityReviewState, EntityID: card.ID, RequireAbsent: true,
				UpdatedAt: request.UpdatedAt, Payload: statePayload})
		result.Cards.Created = append(result.Cards.Created, cardID)
	}
	mutation, err := store.MutateEntities(ctx, request.OperationID, mutations)
	if err != nil {
		return BasicSourceResult{}, err
	}
	for _, revision := range mutation.Revisions {
		if revision.EntityType == EntityCardSource {
			result.SourceRevision = revision
			break
		}
	}
	result.Cards.Batch = &mutation.Batch
	return result, nil
}

func basicDirectionResultFromBatch(batch OperationBatch, request BasicDirectionRequest) (BasicSourceResult, error) {
	result := BasicSourceResult{Cards: ReconcileResult{Batch: &batch}}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil ||
			change.Revision.UpdatedAt != request.UpdatedAt {
			return BasicSourceResult{}, ErrOperationConflict
		}
		revision := *change.Revision
		switch revision.EntityType {
		case EntityCardSource:
			if revision.EntityID != request.SourceID || result.SourceRevision.RevisionID != "" {
				return BasicSourceResult{}, ErrOperationConflict
			}
			var source CardSource
			if err := decodeStrictJSON(revision.Payload, &source); err != nil ||
				!sameStringSet(source.DisabledTemplateIDs, basicDisabledTemplates(request.Direction)) {
				return BasicSourceResult{}, ErrOperationConflict
			}
			result.SourceRevision = revision
		case EntityCard:
			var card Card
			if err := decodeStrictJSON(revision.Payload, &card); err != nil || card.SourceID != request.SourceID {
				return BasicSourceResult{}, ErrOperationConflict
			}
			if len(revision.ParentRevisionIDs) == 0 {
				result.Cards.Created = append(result.Cards.Created, card.ID)
			} else {
				result.Cards.Updated = append(result.Cards.Updated, card.ID)
			}
		case EntityReviewState:
		default:
			return BasicSourceResult{}, ErrOperationConflict
		}
	}
	if result.SourceRevision.RevisionID == "" {
		return BasicSourceResult{}, ErrOperationConflict
	}
	return result, nil
}

func sameStringSet(first, second []string) bool {
	if len(first) != len(second) {
		return false
	}
	left := append([]string(nil), first...)
	right := append([]string(nil), second...)
	sort.Strings(left)
	sort.Strings(right)
	return slicesEqual(left, right)
}

func slicesEqual(first, second []string) bool {
	for index := range first {
		if first[index] != second[index] {
			return false
		}
	}
	return true
}

func (request *BasicSourceRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SourceID) == "" ||
		request.CreatedAt <= 0 || len(request.BlockIDs) < 2 {
		return errors.New("basic flashcard source requires an operation, source, time, question and answer")
	}
	switch request.Direction {
	case BasicDirectionForward, BasicDirectionReverse, BasicDirectionBidirectional, BasicDirectionClosed:
	default:
		return fmt.Errorf("unsupported basic flashcard direction [%s]", request.Direction)
	}
	if err := validateUniqueStrings("basic flashcard block IDs", request.BlockIDs, false); err != nil {
		return err
	}
	return validateUniqueStrings("basic flashcard review set IDs", request.ReviewSetIDs, false)
}

func basicDisabledTemplates(direction string) []string {
	switch direction {
	case BasicDirectionForward:
		return []string{basicReverseTemplateID}
	case BasicDirectionReverse:
		return []string{basicForwardTemplateID}
	case BasicDirectionClosed:
		return []string{basicForwardTemplateID, basicReverseTemplateID}
	default:
		return nil
	}
}

func basicActiveCardIDs(sourceID, direction string) []string {
	ret := make([]string, 0, 2)
	if direction == BasicDirectionForward || direction == BasicDirectionBidirectional {
		ret = append(ret, GeneratedCardID(sourceID, basicForwardTemplateID, BasicDirectionForward))
	}
	if direction == BasicDirectionReverse || direction == BasicDirectionBidirectional {
		ret = append(ret, GeneratedCardID(sourceID, basicReverseTemplateID, BasicDirectionReverse))
	}
	return ret
}

func basicCardIDs(sourceID string) []string {
	return []string{
		GeneratedCardID(sourceID, basicForwardTemplateID, BasicDirectionForward),
		GeneratedCardID(sourceID, basicReverseTemplateID, BasicDirectionReverse),
	}
}

func (store *Store) ensureBasicEntities(ctx context.Context) error {
	values, err := basicEntityPayloads()
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
	_, err = store.MutateEntities(ctx, "builtin-basic-v2:"+DeterministicID("missing", identityParts...), missing)
	return err
}

func prepareBuiltinEntityMutation(current EntityRevision, value *EntityMutation) (bool, error) {
	if bytes.Equal(current.Payload, value.Payload) {
		return false, nil
	}
	if value.EntityType != EntityCardTemplate {
		return false, fmt.Errorf("built-in flashcard entity [%s] has unexpected content", value.EntityID)
	}
	var existing, desired CardTemplate
	if err := decodeStrictJSON(current.Payload, &existing); err != nil {
		return false, err
	}
	if err := decodeStrictJSON(value.Payload, &desired); err != nil {
		return false, err
	}
	existing.ContextPolicy = desired.ContextPolicy
	upgraded, err := CanonicalJSON(existing)
	if err != nil {
		return false, err
	}
	if !bytes.Equal(upgraded, value.Payload) {
		return false, fmt.Errorf("built-in flashcard entity [%s] has unexpected content", value.EntityID)
	}
	value.ExpectedRevisionID = current.RevisionID
	return true, nil
}

func basicEntityPayloads() ([]EntityMutation, error) {
	schema := CardSchema{
		ID: basicSchemaID, Name: "Basic", BuiltinType: "basic-qa",
		Fields: []CardSchemaField{
			{ID: basicPromptFieldID, Name: "Prompt", Type: "block", Required: true, Sort: 0},
			{ID: basicAnswerFieldID, Name: "Answer", Type: "block", Required: true, Sort: 1},
		},
		TemplateIDs: []string{basicForwardTemplateID, basicReverseTemplateID},
	}
	forward := CardTemplate{
		ID: basicForwardTemplateID, SchemaID: basicSchemaID, Name: "Forward",
		GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"forward"}`),
		FrontSpec:      json.RawMessage(`{"fieldID":"` + basicPromptFieldID + `","type":"field"}`),
		BackSpec: json.RawMessage(`{"fieldIDs":["` + basicPromptFieldID + `","` + basicAnswerFieldID +
			`"],"type":"fields"}`),
		AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true,
	}
	reverse := CardTemplate{
		ID: basicReverseTemplateID, SchemaID: basicSchemaID, Name: "Reverse",
		GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"reverse"}`),
		FrontSpec:      json.RawMessage(`{"fieldID":"` + basicAnswerFieldID + `","type":"field"}`),
		BackSpec: json.RawMessage(`{"fieldIDs":["` + basicAnswerFieldID + `","` + basicPromptFieldID +
			`"],"type":"fields"}`),
		AnswerMode: "reveal", ContextPolicy: defaultFlashcardContextPolicy(), Enabled: true,
	}
	ret := make([]EntityMutation, 0, 3)
	for _, item := range []struct {
		entityType EntityType
		entityID   string
		payload    any
	}{
		{EntityCardSchema, schema.ID, schema},
		{EntityCardTemplate, forward.ID, forward},
		{EntityCardTemplate, reverse.ID, reverse},
	} {
		payload, err := CanonicalJSON(item.payload)
		if err != nil {
			return nil, err
		}
		ret = append(ret, EntityMutation{EntityType: item.entityType, EntityID: item.entityID, Payload: payload})
	}
	return ret, nil
}

func defaultFlashcardContextPolicy() json.RawMessage {
	return json.RawMessage(`{"breadcrumb":true,"documentTitle":true}`)
}
