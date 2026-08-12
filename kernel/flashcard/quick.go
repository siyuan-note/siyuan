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
	"strings"
)

// QuickSourceRequest 描述由块创建独立快速卡源的请求。
type QuickSourceRequest struct {
	OperationID string   `json:"operationID"`
	BlockIDs    []string `json:"blockIDs"`
	CreatedAt   int64    `json:"createdAt"`
	Toggle      bool     `json:"toggle,omitempty"`
}

// QuickSourceResult 返回创建或已存在的卡源和卡片 ID。
type QuickSourceResult struct {
	SourceIDs []string `json:"sourceIDs"`
	CardIDs   []string `json:"cardIDs"`
	Action    string   `json:"action"`
}

const (
	QuickSourceActionCreated = "created"
	QuickSourceActionRemoved = "removed"
)

// UpgradeBlockFlashcardMode 将旧快速卡的内置定义原位升级为块闪卡，并保留全部稳定实体 ID。
func (store *Store) UpgradeBlockFlashcardMode(ctx context.Context) (bool, error) {
	schemaRevision, schemaFound, err := store.projection.CurrentEntity(ctx, EntityCardSchema, legacyQuickSchemaID)
	if err != nil {
		return false, err
	}
	templateRevision, templateFound, err := store.projection.CurrentEntity(ctx, EntityCardTemplate,
		legacyQuickTemplateID)
	if err != nil {
		return false, err
	}
	if !schemaFound || schemaRevision.Deleted || !templateFound || templateRevision.Deleted {
		return false, nil
	}
	schemaConflicted, err := store.projection.entityHasUnresolvedConflict(ctx, EntityCardSchema, legacyQuickSchemaID)
	if err != nil {
		return false, err
	}
	templateConflicted, err := store.projection.entityHasUnresolvedConflict(ctx, EntityCardTemplate,
		legacyQuickTemplateID)
	if err != nil {
		return false, err
	}
	if schemaConflicted || templateConflicted {
		return false, nil
	}
	var schema CardSchema
	if err = decodeStrictJSON(schemaRevision.Payload, &schema); err != nil {
		return false, err
	}
	var template CardTemplate
	if err = decodeStrictJSON(templateRevision.Payload, &template); err != nil {
		return false, err
	}
	updatedAt := maxInt64(schemaRevision.UpdatedAt, templateRevision.UpdatedAt) + 1
	mutations := make([]EntityMutation, 0, 2)
	if schema.Name != blockFlashcardName || schema.BuiltinType != blockFlashcardType {
		schema.Name = blockFlashcardName
		schema.BuiltinType = blockFlashcardType
		schema.UpdatedAt = maxInt64(schema.UpdatedAt, updatedAt)
		payload, payloadErr := CanonicalJSON(schema)
		if payloadErr != nil {
			return false, payloadErr
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCardSchema, EntityID: schema.ID,
			ExpectedRevisionID: schemaRevision.RevisionID, UpdatedAt: updatedAt, Payload: payload})
	}
	if template.Name != blockFlashcardName || template.AnswerMode != "auto" ||
		string(template.FrontSpec) != `{"side":"front","type":"block"}` ||
		string(template.BackSpec) != `{"side":"back","type":"block"}` ||
		string(template.ContextPolicy) != `{"type":"block"}` {
		template.Name = blockFlashcardName
		template.FrontSpec = json.RawMessage(`{"side":"front","type":"block"}`)
		template.BackSpec = json.RawMessage(`{"side":"back","type":"block"}`)
		template.AnswerMode = "auto"
		template.ContextPolicy = json.RawMessage(`{"type":"block"}`)
		payload, payloadErr := CanonicalJSON(template)
		if payloadErr != nil {
			return false, payloadErr
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCardTemplate, EntityID: template.ID,
			ExpectedRevisionID: templateRevision.RevisionID, UpdatedAt: updatedAt, Payload: payload})
	}
	if len(mutations) == 0 {
		return false, nil
	}
	operationID := DeterministicID("upgrade-block-flashcard-v1", schemaRevision.RevisionID,
		templateRevision.RevisionID)
	if _, err = store.MutateEntities(ctx, operationID, mutations); err != nil {
		return false, err
	}
	return true, nil
}

// ToggleQuickSources 在全部目标都已启用时取消制卡，否则创建或恢复尚未启用的快速卡源。
func (store *Store) ToggleQuickSources(ctx context.Context, request QuickSourceRequest) (QuickSourceResult, error) {
	if strings.TrimSpace(request.OperationID) == "" || len(request.BlockIDs) == 0 || request.CreatedAt <= 0 {
		return QuickSourceResult{}, errors.New("quick flashcard operation, blocks and time are required")
	}
	blockIDs := uniqueSortedStrings(request.BlockIDs)
	if len(blockIDs) == 0 {
		return QuickSourceResult{}, errors.New("quick flashcard blocks are required")
	}
	result := quickSourceResult(blockIDs)
	allActive := true
	revisions := make([]EntityRevision, 0, len(blockIDs))
	sources := make([]CardSource, 0, len(blockIDs))
	for _, blockID := range blockIDs {
		revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, LegacyQuickSourceID(blockID))
		if err != nil {
			return QuickSourceResult{}, err
		}
		if !found || revision.Deleted {
			allActive = false
			continue
		}
		var source CardSource
		if err = decodeStrictJSON(revision.Payload, &source); err != nil {
			return QuickSourceResult{}, err
		}
		if source.Status != "active" {
			allActive = false
			continue
		}
		revisions = append(revisions, revision)
		sources = append(sources, source)
	}
	if !allActive {
		return store.CreateQuickSources(ctx, request)
	}
	mutations := make([]EntityMutation, 0, len(sources))
	for index, source := range sources {
		source.Status = "deleted"
		mutations = append(mutations, legacyMutation(EntityCardSource, source.ID, revisions[index], true,
			request.CreatedAt, source))
	}
	if _, err := store.MutateEntities(ctx, request.OperationID, mutations); err != nil {
		return QuickSourceResult{}, err
	}
	result.Action = QuickSourceActionRemoved
	return result, nil
}

// CreateQuickSources 创建不依赖卡包的块闪卡卡源。
func (store *Store) CreateQuickSources(ctx context.Context, request QuickSourceRequest) (QuickSourceResult, error) {
	if strings.TrimSpace(request.OperationID) == "" || len(request.BlockIDs) == 0 || request.CreatedAt <= 0 {
		return QuickSourceResult{}, errors.New("quick flashcard operation, blocks and time are required")
	}
	blockIDs := uniqueSortedStrings(request.BlockIDs)
	if len(blockIDs) == 0 {
		return QuickSourceResult{}, errors.New("quick flashcard blocks are required")
	}
	result := quickSourceResult(blockIDs)
	result.Action = QuickSourceActionCreated
	mutations := make([]EntityMutation, 0, len(blockIDs)*4)
	for _, blockID := range blockIDs {
		sourceID := LegacyQuickSourceID(blockID)
		refID := DeterministicID("legacy-card-source-ref", sourceID, legacyQuickFieldID, blockID)
		cardID := LegacyQuickCardID(blockID)
		if err := store.appendLegacyEntityIfMissing(ctx, &mutations, EntityCardSourceRef, refID, request.CreatedAt,
			CardSourceRef{ID: refID, SourceID: sourceID, FieldID: legacyQuickFieldID, EntityType: "block",
				EntityID: blockID, Role: "content", Required: true}); err != nil {
			return QuickSourceResult{}, err
		}
		if err := store.appendQuickSourceMutation(ctx, &mutations, sourceID, refID, request.CreatedAt); err != nil {
			return QuickSourceResult{}, err
		}
		cardRevision, found, err := store.projection.CurrentEntity(ctx, EntityCard, cardID)
		if err != nil {
			return QuickSourceResult{}, err
		}
		resetState := !found || cardRevision.Deleted
		if !found || cardRevision.Deleted {
			card := Card{ID: cardID, SourceID: sourceID, TemplateID: legacyQuickTemplateID,
				VariantKey: "legacy-quick", GenerationStatus: GenerationActive, CreatedAt: request.CreatedAt,
				UpdatedAt: request.CreatedAt}
			mutations = append(mutations, legacyMutation(EntityCard, cardID, cardRevision, found, request.CreatedAt, card))
		} else {
			var card Card
			if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
				return QuickSourceResult{}, err
			}
			if card.GenerationStatus != GenerationActive {
				resetState = card.GenerationStatus == GenerationDeleted
				card.GenerationStatus = GenerationActive
				card.UpdatedAt = request.CreatedAt
				mutations = append(mutations, legacyMutation(EntityCard, cardID, cardRevision, true,
					request.CreatedAt, card))
			}
		}
		stateRevision, stateFound, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
		if err != nil {
			return QuickSourceResult{}, err
		}
		if !stateFound || stateRevision.Deleted || resetState {
			state := ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{State: "new",
				Due: request.CreatedAt, StateRevisionID: OperationRevisionID(request.OperationID, EntityReviewState, cardID)}}
			mutations = append(mutations, legacyMutation(EntityReviewState, cardID, stateRevision, stateFound,
				request.CreatedAt, state))
		}
	}
	if len(mutations) != 0 {
		if _, err := store.MutateEntities(ctx, request.OperationID, mutations); err != nil {
			return QuickSourceResult{}, err
		}
	}
	return result, nil
}

func quickSourceResult(blockIDs []string) QuickSourceResult {
	result := QuickSourceResult{SourceIDs: make([]string, 0, len(blockIDs)), CardIDs: make([]string, 0, len(blockIDs))}
	for _, blockID := range blockIDs {
		result.SourceIDs = append(result.SourceIDs, LegacyQuickSourceID(blockID))
		result.CardIDs = append(result.CardIDs, LegacyQuickCardID(blockID))
	}
	return result
}

func (store *Store) appendQuickSourceMutation(ctx context.Context, mutations *[]EntityMutation,
	sourceID, refID string, updatedAt int64) error {
	revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil {
		return err
	}
	if found && !revision.Deleted {
		var source CardSource
		if err = decodeStrictJSON(revision.Payload, &source); err != nil {
			return err
		}
		if source.Status != "deleted" && source.Status != "orphaned" {
			return nil
		}
		source.Status = "active"
		*mutations = append(*mutations, legacyMutation(EntityCardSource, sourceID, revision, true, updatedAt, source))
		return nil
	}
	source := CardSource{ID: sourceID, SchemaID: legacyQuickSchemaID, SourceType: "block", PrimaryRefID: refID,
		DefaultPresetID: legacyPresetID, GenerationConfig: json.RawMessage(`{"mode":"auto"}`), Status: "active"}
	*mutations = append(*mutations, legacyMutation(EntityCardSource, sourceID, revision, found, updatedAt, source))
	return nil
}
