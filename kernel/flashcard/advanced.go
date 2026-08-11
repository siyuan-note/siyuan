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
)

// AdvancedSourceRequest 由有序块创建分组挖空、单卡逐步揭示或递进式多卡。
type AdvancedSourceRequest struct {
	OperationID          string                `json:"operationID"`
	SourceID             string                `json:"sourceID"`
	Mode                 string                `json:"mode"`
	BlockIDs             []string              `json:"blockIDs"`
	ReviewSetIDs         []string              `json:"reviewSetIDs,omitempty"`
	CreatedAt            int64                 `json:"createdAt"`
	ImageConfig          *ImageOcclusionConfig `json:"imageConfig,omitempty"`
	CorrectOptionIndexes []int                 `json:"correctOptionIndexes,omitempty"`
	RandomizeOptions     bool                  `json:"randomizeOptions"`
	DistractorQuery      *QueryAST             `json:"distractorQuery,omitempty"`
	DynamicDistractors   int                   `json:"dynamicDistractors,omitempty"`
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

func (request *AdvancedSourceRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SourceID) == "" ||
		request.CreatedAt <= 0 || len(request.BlockIDs) == 0 {
		return errors.New("advanced flashcard source requires an operation, source, blocks and time")
	}
	switch request.Mode {
	case AdvancedModeCloze, AdvancedModeOrderedSingle, AdvancedModeOrderedCards:
		if request.ImageConfig != nil || len(request.CorrectOptionIndexes) != 0 || request.DistractorQuery != nil ||
			request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("text flashcard mode must not contain image or choice configuration")
		}
	case AdvancedModeImageOcclusion:
		if len(request.BlockIDs) != 1 || request.ImageConfig == nil {
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
		if len(request.BlockIDs) < 3 || request.ImageConfig != nil || len(request.CorrectOptionIndexes) == 0 {
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
		if len(request.BlockIDs) < 2 || request.ImageConfig != nil || len(request.CorrectOptionIndexes) != 0 ||
			request.DistractorQuery != nil || request.DynamicDistractors != 0 || request.RandomizeOptions {
			return errors.New("multi-line flashcard requires a question and at least one answer")
		}
	default:
		return fmt.Errorf("unsupported advanced flashcard mode [%s]", request.Mode)
	}
	if err := validateUniqueStrings("advanced flashcard block IDs", request.BlockIDs, false); err != nil {
		return err
	}
	return validateUniqueStrings("advanced flashcard review set IDs", request.ReviewSetIDs, false)
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
	references := make([]CardSourceRef, 0, len(request.BlockIDs))
	occlusionIDs := make([]string, len(request.BlockIDs))
	for index, blockID := range request.BlockIDs {
		occlusionID := DeterministicID("advanced-occlusion", request.SourceID, blockID)
		occlusionIDs[index] = occlusionID
		references = append(references, CardSourceRef{
			ID: DeterministicID("advanced-card-source-ref", request.SourceID, blockID), SourceID: request.SourceID,
			FieldID: advancedContentFieldID, EntityType: "block", EntityID: blockID,
			Role: "occlusion:" + occlusionID, Sort: index, Required: true,
		})
	}
	templateID := advancedClozeTemplateID
	sourceType := "cloze"
	disabled := []string{advancedOrderedSingleTemplateID, advancedOrderedCardsTemplateID}
	var config any
	if request.Mode == AdvancedModeCloze {
		cloze := ClozeGenerationConfig{Occlusions: make([]ClozeOcclusion, len(request.BlockIDs)),
			Groups: make([]ClozeGroup, len(request.BlockIDs))}
		for index, occlusionID := range occlusionIDs {
			groupID := DeterministicID("advanced-cloze-group", request.SourceID, request.BlockIDs[index])
			cloze.Occlusions[index] = ClozeOcclusion{ID: occlusionID, GroupIDs: []string{groupID},
				DisplayOrder: index}
			cloze.Groups[index] = ClozeGroup{ID: groupID, DisplayOrder: index}
		}
		config = cloze
	} else {
		sourceType = "ordered"
		ordered := OrderedGenerationConfig{Steps: make([]OrderedStep, len(request.BlockIDs))}
		for index, occlusionID := range occlusionIDs {
			ordered.Steps[index] = OrderedStep{
				ID:           DeterministicID("advanced-ordered-step", request.SourceID, request.BlockIDs[index]),
				DisplayOrder: index, OcclusionIDs: []string{occlusionID}, RevealBehavior: "append",
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
	items := []struct {
		entityType EntityType
		entityID   string
		payload    any
	}{{EntityCardSchema, schema.ID, schema}, {EntityCardSchema, imageSchema.ID, imageSchema},
		{EntityCardTemplate, imageTemplate.ID, imageTemplate}, {EntityCardSchema, choiceSchema.ID, choiceSchema},
		{EntityCardTemplate, choiceTemplate.ID, choiceTemplate},
		{EntityCardSchema, multiLineSchema.ID, multiLineSchema},
		{EntityCardTemplate, multiLineTemplate.ID, multiLineTemplate}}
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
