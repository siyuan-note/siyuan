// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"sort"
	"strings"
)

// ReorderAdvancedSourceRequest 只允许重新排列现有步骤，不修改内容、引用或卡片身份。
type ReorderAdvancedSourceRequest struct {
	SourceID           string   `json:"sourceID"`
	ExpectedRevisionID string   `json:"expectedRevisionID"`
	OrderedStepIDs     []string `json:"orderedStepIDs"`
	OperationID        string   `json:"operationID"`
	UpdatedAt          int64    `json:"updatedAt"`
}

type ReorderAdvancedSourceResult struct {
	SourceRevision EntityRevision `json:"sourceRevision"`
	UpdatedCardIDs []string       `json:"updatedCardIDs"`
	Batch          OperationBatch `json:"batch"`
}

// Validate 在打开存储前检查请求的结构。
func (request ReorderAdvancedSourceRequest) Validate() error {
	if strings.TrimSpace(request.SourceID) == "" || strings.TrimSpace(request.ExpectedRevisionID) == "" || strings.TrimSpace(request.OperationID) == "" || request.UpdatedAt <= 0 {
		return errors.New("ordered source reorder identity is required")
	}
	if len(request.OrderedStepIDs) == 0 || len(request.OrderedStepIDs) > 1000 {
		return errors.New("ordered steps must contain 1 to 1000 IDs")
	}
	return validateUniqueStrings("ordered step IDs", request.OrderedStepIDs, false)
}

// ReorderAdvancedSource 在一个权威批次内重排步骤，并保留所有卡片状态与原文引用。
func (store *Store) ReorderAdvancedSource(ctx context.Context, request ReorderAdvancedSourceRequest) (ReorderAdvancedSourceResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReorderAdvancedSourceResult{}, errors.New("flashcard store is closed")
	}
	if err := request.Validate(); err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	if batch, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return ReorderAdvancedSourceResult{}, err
	} else if found {
		return store.reorderedSourceResult(ctx, batch, request)
	}
	revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	if !found || revision.Deleted {
		return ReorderAdvancedSourceResult{}, ErrEntityNotFound
	}
	if revision.RevisionID != request.ExpectedRevisionID {
		return ReorderAdvancedSourceResult{}, ErrRevisionConflict
	}
	var source CardSource
	if err = decodeStrictJSON(revision.Payload, &source); err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	if source.SchemaID != advancedSchemaID || source.SourceType != "ordered" || source.Status == "deleted" || source.PluginNamespace != "" {
		return ReorderAdvancedSourceResult{}, errors.New("source is not a built-in ordered source")
	}
	originalSource := source
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	if err = config.validate(); err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	if len(config.Steps) != len(request.OrderedStepIDs) {
		return ReorderAdvancedSourceResult{}, errors.New("reorder requires all existing steps")
	}
	positions := map[string]int{}
	for i, id := range request.OrderedStepIDs {
		positions[id] = i
	}
	for i := range config.Steps {
		position, ok := positions[config.Steps[i].ID]
		if !ok {
			return ReorderAdvancedSourceResult{}, errors.New("reorder contains unknown steps")
		}
		config.Steps[i].DisplayOrder = position
	}
	source.GenerationConfig, err = CanonicalJSON(config)
	if err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	payload, err := CanonicalJSON(source)
	if err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	mutations := []EntityMutation{{EntityType: EntityCardSource, EntityID: source.ID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: request.UpdatedAt, Payload: payload}}
	cards, err := store.projection.cardRevisionsBySource(ctx, source.ID)
	if err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	variants := map[string]map[string]GeneratedVariant{}
	originalVariants := map[string]map[string]GeneratedVariant{}
	seen := map[string]map[string]bool{}
	for _, current := range cards {
		var card Card
		if err = decodeStrictJSON(current.Payload, &card); err != nil {
			return ReorderAdvancedSourceResult{}, err
		}
		if card.TemplateID != advancedOrderedSingleTemplateID && card.TemplateID != advancedOrderedCardsTemplateID {
			return ReorderAdvancedSourceResult{}, errors.New("ordered source contains unsupported card templates")
		}
		byKey, loaded := variants[card.TemplateID]
		if !loaded {
			templateRevision, exists, readErr := store.projection.CurrentEntity(ctx, EntityCardTemplate, card.TemplateID)
			if readErr != nil {
				return ReorderAdvancedSourceResult{}, readErr
			}
			if !exists || templateRevision.Deleted {
				return ReorderAdvancedSourceResult{}, ErrEntityNotFound
			}
			var template CardTemplate
			if err = decodeStrictJSON(templateRevision.Payload, &template); err != nil {
				return ReorderAdvancedSourceResult{}, err
			}
			builtins, _ := advancedTemplates()
			valid := false
			for _, builtin := range builtins {
				if builtin.ID == template.ID && template.SchemaID == advancedSchemaID && reflect.DeepEqual(template.GenerationRule, builtin.GenerationRule) {
					valid = true
				}
			}
			if !valid {
				return ReorderAdvancedSourceResult{}, errors.New("ordered template generation rule is not supported")
			}
			generated, enumErr := EnumerateCardVariants(source, template)
			if enumErr != nil {
				return ReorderAdvancedSourceResult{}, enumErr
			}
			byKey = map[string]GeneratedVariant{}
			for _, variant := range generated {
				byKey[variant.Key] = variant
			}
			variants[card.TemplateID] = byKey
			previous, previousErr := EnumerateCardVariants(originalSource, template)
			if previousErr != nil {
				return ReorderAdvancedSourceResult{}, previousErr
			}
			originalVariants[card.TemplateID] = map[string]GeneratedVariant{}
			for _, variant := range previous {
				originalVariants[card.TemplateID][variant.Key] = variant
			}
			seen[card.TemplateID] = map[string]bool{}
		}
		variant, exists := byKey[card.VariantKey]
		if !exists {
			if card.GenerationStatus == GenerationDeleted {
				continue
			}
			return ReorderAdvancedSourceResult{}, errors.New("ordered card has an unknown active variant")
		}
		if seen[card.TemplateID][card.VariantKey] {
			return ReorderAdvancedSourceResult{}, errors.New("duplicate ordered card variant")
		}
		seen[card.TemplateID][card.VariantKey] = true
		if !reflect.DeepEqual(card.VariantData, originalVariants[card.TemplateID][card.VariantKey].Data) {
			return ReorderAdvancedSourceResult{}, errors.New("ordered card data is inconsistent with its source")
		}
		if reflect.DeepEqual(card.VariantData, variant.Data) {
			continue
		}
		card.VariantData = variant.Data
		card.UpdatedAt = request.UpdatedAt
		cardPayload, payloadErr := CanonicalJSON(card)
		if payloadErr != nil {
			return ReorderAdvancedSourceResult{}, payloadErr
		}
		mutations = append(mutations, EntityMutation{EntityType: EntityCard, EntityID: card.ID, ExpectedRevisionID: current.RevisionID, UpdatedAt: request.UpdatedAt, Payload: cardPayload})
	}
	if len(variants) == 0 {
		return ReorderAdvancedSourceResult{}, errors.New("ordered source has no cards")
	}
	for _, templateID := range []string{advancedOrderedSingleTemplateID, advancedOrderedCardsTemplateID} {
		if !slices.Contains(source.DisabledTemplateIDs, templateID) && variants[templateID] == nil {
			return ReorderAdvancedSourceResult{}, errors.New("ordered source is missing its active template cards")
		}
	}
	for templateID, byKey := range variants {
		for key := range byKey {
			if !seen[templateID][key] {
				return ReorderAdvancedSourceResult{}, errors.New("ordered source is missing an existing variant card")
			}
		}
	}
	result, err := store.mutateEntitiesLocked(ctx, request.OperationID, mutations)
	if err != nil {
		return ReorderAdvancedSourceResult{}, err
	}
	return store.reorderedSourceResult(ctx, result.Batch, request)
}

func (store *Store) reorderedSourceResult(ctx context.Context, batch OperationBatch, request ReorderAdvancedSourceRequest) (ReorderAdvancedSourceResult, error) {
	result := ReorderAdvancedSourceResult{Batch: batch, UpdatedCardIDs: []string{}}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		revision := *change.Revision
		if revision.Deleted || revision.UpdatedAt != request.UpdatedAt || len(revision.ParentRevisionIDs) != 1 {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		switch revision.EntityType {
		case EntityCardSource:
			if result.SourceRevision.RevisionID != "" || revision.EntityID != request.SourceID || revision.ParentRevisionIDs[0] != request.ExpectedRevisionID {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			var source CardSource
			if decodeStrictJSON(revision.Payload, &source) != nil || source.SourceType != "ordered" || source.SchemaID != advancedSchemaID {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			var config OrderedGenerationConfig
			if decodeStrictJSON(source.GenerationConfig, &config) != nil || config.validate() != nil {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			sort.Slice(config.Steps, func(i, j int) bool { return config.Steps[i].DisplayOrder < config.Steps[j].DisplayOrder })
			ids := []string{}
			for i, step := range config.Steps {
				if step.DisplayOrder != i {
					return ReorderAdvancedSourceResult{}, ErrOperationConflict
				}
				ids = append(ids, step.ID)
			}
			if !reflect.DeepEqual(ids, request.OrderedStepIDs) {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			result.SourceRevision = revision
		case EntityCard:
			var card Card
			if decodeStrictJSON(revision.Payload, &card) != nil || card.SourceID != request.SourceID {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			result.UpdatedCardIDs = append(result.UpdatedCardIDs, card.ID)
		default:
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
	}
	if result.SourceRevision.RevisionID == "" {
		return ReorderAdvancedSourceResult{}, ErrOperationConflict
	}
	// 根据父修订复核真正的纯排序语义，不能将同 ID 的其他实体修改当作成功重试。
	var reordered CardSource
	if decodeStrictJSON(result.SourceRevision.Payload, &reordered) != nil {
		return ReorderAdvancedSourceResult{}, ErrOperationConflict
	}
	// 每个模板只枚举一次，避免逐卡重新构造全部递进上下文。
	templates, _ := advancedTemplates()
	newVariantsByTemplate := map[string]map[string]GeneratedVariant{}
	for _, template := range templates {
		if template.ID != advancedOrderedSingleTemplateID && template.ID != advancedOrderedCardsTemplateID {
			continue
		}
		variants, err := EnumerateCardVariants(reordered, template)
		if err != nil {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		byKey := map[string]GeneratedVariant{}
		for _, variant := range variants {
			byKey[variant.Key] = variant
		}
		newVariantsByTemplate[template.ID] = byKey
	}
	batchCards := map[string]Card{}
	for _, change := range batch.Changes {
		if change.Revision.EntityType != EntityCard {
			continue
		}
		var card Card
		if decodeStrictJSON(change.Revision.Payload, &card) != nil {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		key := cardVariantMapKey(card.TemplateID, card.VariantKey)
		if _, exists := batchCards[key]; exists {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		batchCards[key] = card
	}
	for _, change := range batch.Changes {
		revision := *change.Revision
		parent, found, err := store.projection.entityRevisionByID(ctx, revision.ParentRevisionIDs[0])
		if err != nil {
			return ReorderAdvancedSourceResult{}, err
		}
		if !found || parent.Deleted || parent.EntityType != revision.EntityType || parent.EntityID != revision.EntityID {
			return ReorderAdvancedSourceResult{}, ErrOperationConflict
		}
		switch revision.EntityType {
		case EntityCardSource:
			var before CardSource
			if decodeStrictJSON(parent.Payload, &before) != nil {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			original := before
			var config OrderedGenerationConfig
			if decodeStrictJSON(before.GenerationConfig, &config) != nil || config.validate() != nil || len(config.Steps) != len(request.OrderedStepIDs) {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			positions := map[string]int{}
			for i, id := range request.OrderedStepIDs {
				positions[id] = i
			}
			for i := range config.Steps {
				position, ok := positions[config.Steps[i].ID]
				if !ok {
					return ReorderAdvancedSourceResult{}, ErrOperationConflict
				}
				config.Steps[i].DisplayOrder = position
			}
			before.GenerationConfig, err = CanonicalJSON(config)
			if err != nil || !sameEntityPayload(before, reordered) {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			// 活跃题型的所有变化变体必须同批更新，拒绝仅修改卡源的其他操作。
			for _, template := range templates {
				if template.ID != advancedOrderedSingleTemplateID && template.ID != advancedOrderedCardsTemplateID {
					continue
				}
				if slices.Contains(original.DisabledTemplateIDs, template.ID) {
					continue
				}
				oldVariants, oldErr := EnumerateCardVariants(original, template)
				newVariants := newVariantsByTemplate[template.ID]
				if oldErr != nil {
					return ReorderAdvancedSourceResult{}, ErrOperationConflict
				}
				oldData := map[string]GeneratedVariant{}
				for _, variant := range oldVariants {
					oldData[variant.Key] = variant
				}
				for _, variant := range newVariants {
					if reflect.DeepEqual(oldData[variant.Key].Data, variant.Data) {
						continue
					}
					card, matched := batchCards[cardVariantMapKey(template.ID, variant.Key)]
					if !matched || !reflect.DeepEqual(card.VariantData, variant.Data) {
						return ReorderAdvancedSourceResult{}, ErrOperationConflict
					}
				}
			}
		case EntityCard:
			var before, after Card
			if decodeStrictJSON(parent.Payload, &before) != nil || decodeStrictJSON(revision.Payload, &after) != nil {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
			variant, matched := newVariantsByTemplate[before.TemplateID][before.VariantKey]
			if matched {
				before.VariantData = variant.Data
			}
			before.UpdatedAt = request.UpdatedAt
			if !matched || !sameEntityPayload(before, after) {
				return ReorderAdvancedSourceResult{}, ErrOperationConflict
			}
		}
	}
	sort.Strings(result.UpdatedCardIDs)
	return result, nil
}
