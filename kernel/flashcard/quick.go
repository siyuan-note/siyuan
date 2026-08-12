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
}

// QuickSourceResult 返回创建或已存在的卡源和卡片 ID。
type QuickSourceResult struct {
	SourceIDs []string `json:"sourceIDs"`
	CardIDs   []string `json:"cardIDs"`
}

// CreateQuickSources 创建不依赖复习集或旧卡包的快速卡源。
func (store *Store) CreateQuickSources(ctx context.Context, request QuickSourceRequest) (QuickSourceResult, error) {
	if strings.TrimSpace(request.OperationID) == "" || len(request.BlockIDs) == 0 || request.CreatedAt <= 0 {
		return QuickSourceResult{}, errors.New("quick flashcard operation, blocks and time are required")
	}
	blockIDs := uniqueSortedStrings(request.BlockIDs)
	if len(blockIDs) == 0 {
		return QuickSourceResult{}, errors.New("quick flashcard blocks are required")
	}
	result := QuickSourceResult{SourceIDs: make([]string, 0, len(blockIDs)), CardIDs: make([]string, 0, len(blockIDs))}
	mutations := make([]EntityMutation, 0, len(blockIDs)*4)
	for _, blockID := range blockIDs {
		sourceID := LegacyQuickSourceID(blockID)
		refID := DeterministicID("legacy-card-source-ref", sourceID, legacyQuickFieldID, blockID)
		cardID := LegacyQuickCardID(blockID)
		result.SourceIDs = append(result.SourceIDs, sourceID)
		result.CardIDs = append(result.CardIDs, cardID)
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
		DefaultPresetID: legacyPresetID, GenerationConfig: json.RawMessage(`{"legacyQuick":true}`), Status: "active"}
	*mutations = append(*mutations, legacyMutation(EntityCardSource, sourceID, revision, found, updatedAt, source))
	return nil
}
