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
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

// AnkiImportRequest 描述一次可恢复、可重复执行的 Anki 卡包导入。
type AnkiImportRequest struct {
	OperationID string            `json:"operationID"`
	PackagePath string            `json:"-"`
	TargetID    string            `json:"targetID,omitempty"`
	ImportedAt  int64             `json:"importedAt"`
	NewLimit    int               `json:"newLimit,omitempty"`
	ReviewLimit int               `json:"reviewLimit,omitempty"`
	Writer      AnkiContentWriter `json:"-"`
}

type ankiImportOperationPayload struct {
	PackageDigest string `json:"packageDigest"`
	CollectionID  string `json:"collectionID"`
	TargetID      string `json:"targetID,omitempty"`
	ImportedAt    int64  `json:"importedAt"`
}

// AnkiImportReport 汇总写入正文和 v2 权威记录的结果。
type AnkiImportReport struct {
	CollectionID   string `json:"collectionID"`
	PackageDigest  string `json:"packageDigest"`
	Notes          int    `json:"notes"`
	Cards          int    `json:"cards"`
	ReviewEvents   int    `json:"reviewEvents"`
	ReviewSets     int    `json:"reviewSets"`
	Tags           int    `json:"tags"`
	Media          int    `json:"media"`
	UpdatedSources int    `json:"updatedSources"`
	RetiredSources int    `json:"retiredSources"`
}

type ankiImportDefinitions struct {
	models      map[int64]ankiModel
	templates   map[int64]map[int]string
	reviewSets  map[int64]string
	tagIDs      map[string]string
	definitions []EntityMutation
}

// ImportAnkiPackage 导入字段正文、媒体、卡片关系、当前排期和可解析复习历史。
func (store *Store) ImportAnkiPackage(ctx context.Context,
	request AnkiImportRequest) (AnkiImportReport, error) {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.PackagePath) == "" ||
		request.ImportedAt <= 0 || request.Writer == nil {
		return AnkiImportReport{}, errors.New("Anki import request is invalid")
	}
	preview, err := PreviewAnkiPackage(ctx, request.PackagePath)
	if err != nil {
		return AnkiImportReport{}, err
	}
	request, err = store.bindAnkiImportOperation(ctx, request, preview)
	if err != nil {
		return AnkiImportReport{}, err
	}
	data, err := readAnkiImportPackage(ctx, request.PackagePath, request.Writer)
	if err != nil {
		return AnkiImportReport{}, err
	}
	if data.Preview.PackageDigest != preview.PackageDigest || data.Preview.CollectionID != preview.CollectionID {
		return AnkiImportReport{}, errors.New("Anki package changed while it was being imported")
	}
	definitions, err := store.prepareAnkiDefinitions(ctx, data, request)
	if err != nil {
		return AnkiImportReport{}, err
	}
	if len(definitions.definitions) != 0 {
		if _, err = store.MutateEntities(ctx, request.OperationID+":definitions", definitions.definitions); err != nil {
			return AnkiImportReport{}, err
		}
	}
	contentNotes, err := store.prepareAnkiContentNotes(ctx, data, definitions)
	if err != nil {
		return AnkiImportReport{}, err
	}
	written, err := request.Writer.WriteNotes(ctx, contentNotes)
	if err != nil {
		return AnkiImportReport{}, err
	}
	report := AnkiImportReport{CollectionID: data.Preview.CollectionID,
		PackageDigest: data.Preview.PackageDigest, ReviewSets: len(data.Decks), Tags: len(definitions.tagIDs),
		Media: len(data.MediaPaths)}
	cardsByNote := map[int64][]ankiImportCard{}
	for _, card := range data.Cards {
		cardsByNote[card.NoteID] = append(cardsByNote[card.NoteID], card)
	}
	reviewsByCard := map[int64][]ankiImportReview{}
	for _, review := range data.Reviews {
		reviewsByCard[review.CardID] = append(reviewsByCard[review.CardID], review)
	}
	for _, note := range data.Notes {
		if err = ctx.Err(); err != nil {
			return AnkiImportReport{}, err
		}
		sourceID := ankiSourceID(data.Preview.CollectionID, note)
		content, found := written[sourceID]
		if !found {
			return AnkiImportReport{}, fmt.Errorf("Anki content writer omitted note [%d]", note.ID)
		}
		updated, cards, reviews, importErr := store.importAnkiNote(ctx, request, data, definitions, note,
			cardsByNote[note.ID], reviewsByCard, content)
		if importErr != nil {
			return AnkiImportReport{}, fmt.Errorf("import Anki note [%d]: %w", note.ID, importErr)
		}
		report.Notes++
		report.Cards += cards
		report.ReviewEvents += reviews
		if updated {
			report.UpdatedSources++
		}
	}
	report.RetiredSources, err = store.retireMissingAnkiSources(ctx, request, data, written)
	if err != nil {
		return AnkiImportReport{}, err
	}
	return report, nil
}

func (store *Store) bindAnkiImportOperation(ctx context.Context, request AnkiImportRequest,
	preview AnkiPackagePreview) (AnkiImportRequest, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return request, errors.New("flashcard store is closed")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return request, err
	} else if found {
		if len(existing.Changes) != 1 || existing.Changes[0].Kind != RecordEvent ||
			existing.Changes[0].Event == nil || existing.Changes[0].Event.EventType != EventAnkiImportStarted {
			return request, ErrOperationConflict
		}
		var payload ankiImportOperationPayload
		if err := decodeStrictJSON(existing.Changes[0].Event.Payload, &payload); err != nil ||
			payload.PackageDigest != preview.PackageDigest || payload.CollectionID != preview.CollectionID ||
			payload.TargetID != request.TargetID || payload.ImportedAt <= 0 {
			return request, ErrOperationConflict
		}
		request.ImportedAt = payload.ImportedAt
		return request, nil
	}
	payload := ankiImportOperationPayload{PackageDigest: preview.PackageDigest,
		CollectionID: preview.CollectionID, TargetID: request.TargetID, ImportedAt: request.ImportedAt}
	payloadJSON, err := CanonicalJSON(payload)
	if err != nil {
		return request, err
	}
	event := Event{EventType: EventAnkiImportStarted,
		EventID: DeterministicID("anki-import-started", request.OperationID), EntityID: preview.CollectionID,
		OccurredAt: request.ImportedAt, Payload: payloadJSON}
	if err = event.Validate(); err != nil {
		return request, err
	}
	if _, err = store.applyLocked(ctx, request.OperationID,
		[]Change{{Kind: RecordEvent, Event: &event}}); err != nil {
		return request, err
	}
	return request, nil
}

func (store *Store) prepareAnkiDefinitions(ctx context.Context, data ankiImportPackage,
	request AnkiImportRequest) (ankiImportDefinitions, error) {
	ret := ankiImportDefinitions{models: map[int64]ankiModel{}, templates: map[int64]map[int]string{},
		reviewSets: map[int64]string{}, tagIDs: map[string]string{}}
	for _, model := range data.Models {
		ret.models[model.ID] = model
		if len(model.Tmpls) == 0 {
			return ret, fmt.Errorf("Anki note type [%d] has no templates", model.ID)
		}
		schemaID := DeterministicID("anki-schema", data.Preview.CollectionID, strconv.FormatInt(model.ID, 10))
		fields := make([]CardSchemaField, 0, len(model.Flds))
		for _, field := range model.Flds {
			fields = append(fields, CardSchemaField{ID: ankiFieldID(data.Preview.CollectionID, model.ID, field.Ord),
				Name: field.Name, Type: "block", Required: false, Sort: field.Ord})
		}
		sort.Slice(fields, func(i, j int) bool { return fields[i].Sort < fields[j].Sort })
		templateIDs := make([]string, 0, len(model.Tmpls))
		ret.templates[model.ID] = map[int]string{}
		for _, template := range model.Tmpls {
			templateID := DeterministicID("anki-template", data.Preview.CollectionID,
				strconv.FormatInt(model.ID, 10), strconv.Itoa(template.Ord))
			ret.templates[model.ID][template.Ord] = templateID
			templateIDs = append(templateIDs, templateID)
			frontFields := ankiTemplateFieldIDs(data.Preview.CollectionID, model, template.QFmt)
			backFields := ankiTemplateFieldIDs(data.Preview.CollectionID, model, template.QFmt+template.AFmt)
			frontSpec, _ := CanonicalJSON(map[string]any{"fieldIDs": frontFields, "type": "anki",
				"markup": safeAnkiTemplateMarkup(template.QFmt, data.MediaPaths)})
			backSpec, _ := CanonicalJSON(map[string]any{"fieldIDs": backFields, "type": "anki",
				"markup": safeAnkiTemplateMarkup(template.AFmt, data.MediaPaths)})
			contextPolicy, _ := CanonicalJSON(map[string]any{"anki": map[string]any{
				"modelID": model.ID, "ord": template.Ord, "qfmt": template.QFmt, "afmt": template.AFmt,
			}})
			value := CardTemplate{ID: templateID, SchemaID: schemaID, Name: template.Name,
				GenerationRule: json.RawMessage(`{"mode":"importedVariants"}`), FrontSpec: frontSpec,
				BackSpec: backSpec, AnswerMode: "reveal", ContextPolicy: contextPolicy,
				Style: safeAnkiTemplateStyle(model.CSS, data.MediaPaths), Enabled: true}
			if err := store.appendAnkiDefinitionMutation(ctx, &ret.definitions, request, EntityCardTemplate,
				templateID, value, false); err != nil {
				return ret, err
			}
		}
		schemaTime := data.Preview.CollectionCrt * 1000
		if schemaTime <= 0 {
			schemaTime = request.ImportedAt
		}
		schema := CardSchema{ID: schemaID, Name: model.Name, BuiltinType: "anki",
			Fields: fields, TemplateIDs: templateIDs, CreatedAt: schemaTime, UpdatedAt: schemaTime}
		if err := store.appendAnkiDefinitionMutation(ctx, &ret.definitions, request, EntityCardSchema,
			schemaID, schema, false); err != nil {
			return ret, err
		}
	}
	for _, deck := range data.Decks {
		newLimit, reviewLimit := request.NewLimit, request.ReviewLimit
		if newLimit <= 0 {
			newLimit = 20
		}
		if reviewLimit <= 0 {
			reviewLimit = 200
		}
		setID := DeterministicID("anki-review-set", data.Preview.CollectionID, strconv.FormatInt(deck.ID, 10))
		ret.reviewSets[deck.ID] = setID
		set := ReviewSet{ID: setID, Name: deck.Name, NewLimit: newLimit, ReviewLimit: reviewLimit,
			DefaultReviewMode: "normal"}
		if err := store.appendAnkiDefinitionMutation(ctx, &ret.definitions, request, EntityReviewSet, setID,
			set, true); err != nil {
			return ret, err
		}
	}
	for _, note := range data.Notes {
		for _, tagName := range note.Tags {
			if err := store.appendAnkiTags(ctx, &ret, request, data.Preview.CollectionID, tagName); err != nil {
				return ret, err
			}
		}
	}
	return ret, nil
}

func (store *Store) appendAnkiDefinitionMutation(ctx context.Context, mutations *[]EntityMutation,
	request AnkiImportRequest, entityType EntityType, entityID string, payload any, preserveExisting bool) error {
	encoded, err := CanonicalJSON(payload)
	if err != nil {
		return err
	}
	current, found, err := store.projection.CurrentEntity(ctx, entityType, entityID)
	if err != nil {
		return err
	}
	if found && !current.Deleted && (preserveExisting || string(current.Payload) == string(encoded)) {
		return nil
	}
	mutation := EntityMutation{EntityType: entityType, EntityID: entityID, UpdatedAt: request.ImportedAt,
		Payload: encoded}
	if found {
		mutation.ExpectedRevisionID = current.RevisionID
	} else {
		mutation.RequireAbsent = true
	}
	*mutations = append(*mutations, mutation)
	return nil
}

func (store *Store) appendAnkiTags(ctx context.Context, definitions *ankiImportDefinitions,
	request AnkiImportRequest, collectionID, fullName string) error {
	parts := strings.Split(fullName, "::")
	parentID := ""
	pathParts := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		pathParts = append(pathParts, NormalizeTagName(part))
		pathKey := strings.Join(pathParts, "::")
		tagID, found := definitions.tagIDs[pathKey]
		if !found {
			tagID = DeterministicID("anki-tag", collectionID, pathKey)
			definitions.tagIDs[pathKey] = tagID
			tag := Tag{ID: tagID, ParentID: parentID, Name: part, NormalizedName: NormalizeTagName(part)}
			if err := store.appendAnkiDefinitionMutation(ctx, &definitions.definitions, request, EntityTag,
				tagID, tag, true); err != nil {
				return err
			}
		}
		parentID = tagID
	}
	return nil
}

func (store *Store) prepareAnkiContentNotes(ctx context.Context, data ankiImportPackage,
	definitions ankiImportDefinitions) ([]AnkiContentNote, error) {
	ret := make([]AnkiContentNote, 0, len(data.Notes))
	for _, note := range data.Notes {
		model, found := definitions.models[note.ModelID]
		if !found || len(note.Fields) != len(model.Flds) {
			return nil, fmt.Errorf("Anki note [%d] fields do not match note type [%d]", note.ID, note.ModelID)
		}
		sourceID := ankiSourceID(data.Preview.CollectionID, note)
		content := AnkiContentNote{SourceID: sourceID, NoteID: note.ID, GUID: note.GUID,
			ModelID: note.ModelID, ModelName: model.Name, ExistingFieldIDs: map[int]string{}}
		for _, field := range model.Flds {
			if field.Ord < 0 || field.Ord >= len(note.Fields) {
				return nil, fmt.Errorf("Anki note [%d] field order [%d] is invalid", note.ID, field.Ord)
			}
			content.Fields = append(content.Fields, AnkiContentField{Ord: field.Ord, Name: field.Name,
				Value: note.Fields[field.Ord]})
		}
		if revision, sourceFound, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID); err != nil {
			return nil, err
		} else if sourceFound && !revision.Deleted {
			references, refErr := store.projection.CardSourceReferences(ctx, sourceID)
			if refErr != nil {
				return nil, refErr
			}
			for _, reference := range references {
				if reference.Role == "container" {
					content.ExistingContainerID = reference.EntityID
				}
				for _, field := range model.Flds {
					if reference.FieldID == ankiFieldID(data.Preview.CollectionID, model.ID, field.Ord) {
						content.ExistingFieldIDs[field.Ord] = reference.EntityID
					}
				}
			}
		}
		ret = append(ret, content)
	}
	return ret, nil
}

func (store *Store) importAnkiNote(ctx context.Context, request AnkiImportRequest, data ankiImportPackage,
	definitions ankiImportDefinitions, note ankiImportNote, noteCards []ankiImportCard,
	reviewsByCard map[int64][]ankiImportReview, written AnkiWrittenNote) (bool, int, int, error) {
	model := definitions.models[note.ModelID]
	if written.ContainerID == "" || len(written.FieldIDs) != len(model.Flds) || len(noteCards) == 0 {
		return false, 0, 0, errors.New("Anki note content or cards are incomplete")
	}
	sourceID := ankiSourceID(data.Preview.CollectionID, note)
	variants := make([]ImportedVariant, 0, len(noteCards))
	templateForCard := map[int64]string{}
	reviewSetIDs := make([]string, 0)
	reviewSetIDSet := map[string]struct{}{}
	for _, importedCard := range noteCards {
		templateOrd := importedCard.Ord
		if model.Type == 1 {
			templateOrd = model.Tmpls[0].Ord
		}
		templateID := definitions.templates[note.ModelID][templateOrd]
		if templateID == "" {
			return false, 0, 0, fmt.Errorf("Anki card [%d] references missing template [%d]", importedCard.ID,
				templateOrd)
		}
		key := "anki-card:" + strconv.FormatInt(importedCard.ID, 10)
		setID := definitions.reviewSets[importedCard.DeckID]
		if setID == "" {
			return false, 0, 0, fmt.Errorf("Anki card [%d] references missing deck [%d]", importedCard.ID,
				importedCard.DeckID)
		}
		if _, found := reviewSetIDSet[setID]; !found {
			reviewSetIDSet[setID] = struct{}{}
			reviewSetIDs = append(reviewSetIDs, setID)
		}
		variantData, _ := CanonicalJSON(map[string]any{"ankiCardID": importedCard.ID, "ord": importedCard.Ord,
			"reviewSetID": setID})
		variants = append(variants, ImportedVariant{TemplateID: templateID, Key: key, Data: variantData})
		templateForCard[importedCard.ID] = templateID
	}
	sort.Strings(reviewSetIDs)
	tagIDs := make([]string, 0, len(note.Tags))
	tagIDSet := map[string]struct{}{}
	for _, tagName := range note.Tags {
		if tagID := definitions.tagIDs[normalizedAnkiTagPath(tagName)]; tagID != "" {
			if _, found := tagIDSet[tagID]; !found {
				tagIDSet[tagID] = struct{}{}
				tagIDs = append(tagIDs, tagID)
			}
		}
	}
	sort.Strings(tagIDs)
	importConfig := ImportedGenerationConfig{CollectionID: data.Preview.CollectionID, NoteID: note.ID,
		GUID: note.GUID, ModelID: note.ModelID, ReviewSetIDs: reviewSetIDs, TagIDs: tagIDs, Variants: variants}
	config, err := CanonicalJSON(importConfig)
	if err != nil {
		return false, 0, 0, err
	}
	operationID := request.OperationID + ":note:" + sourceID
	if _, found, err := store.findAppliedOperation(ctx, operationID); err != nil {
		return false, 0, 0, err
	} else if found {
		return false, len(noteCards), countAnkiReviews(noteCards, reviewsByCard), nil
	}
	changes := make([]Change, 0)
	containerRef := CardSourceRef{ID: DeterministicID("anki-source-container-ref", sourceID), SourceID: sourceID,
		EntityType: "block", EntityID: written.ContainerID, Role: "container", Required: true}
	if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt, EntityCardSourceRef,
		containerRef.ID, containerRef, false); err != nil {
		return false, 0, 0, err
	}
	for _, field := range model.Flds {
		blockID := written.FieldIDs[field.Ord]
		if blockID == "" {
			return false, 0, 0, fmt.Errorf("Anki field [%d] has no written block", field.Ord)
		}
		fieldID := ankiFieldID(data.Preview.CollectionID, model.ID, field.Ord)
		ref := CardSourceRef{ID: DeterministicID("anki-source-field-ref", sourceID, fieldID), SourceID: sourceID,
			FieldID: fieldID, EntityType: "block", EntityID: blockID, Role: "field", Sort: field.Ord + 1,
			Required: false}
		if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
			EntityCardSourceRef, ref.ID, ref, false); err != nil {
			return false, 0, 0, err
		}
	}
	schemaID := DeterministicID("anki-schema", data.Preview.CollectionID, strconv.FormatInt(model.ID, 10))
	source := CardSource{ID: sourceID, SchemaID: schemaID, SourceType: "anki", PrimaryRefID: containerRef.ID,
		DefaultPresetID: legacyPresetID, GenerationConfig: config, Status: "active"}
	currentSource, sourceFound, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil {
		return false, 0, 0, err
	}
	previousConfig := ImportedGenerationConfig{}
	if sourceFound && !currentSource.Deleted {
		var preserved CardSource
		if err = decodeStrictJSON(currentSource.Payload, &preserved); err != nil {
			return false, 0, 0, err
		}
		source.DefaultPresetID = preserved.DefaultPresetID
		source.Priority = preserved.Priority
		source.DisabledTemplateIDs = preserved.DisabledTemplateIDs
		if err = decodeStrictJSON(preserved.GenerationConfig, &previousConfig); err != nil {
			return false, 0, 0, err
		}
	}
	if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt, EntityCardSource,
		sourceID, source, false); err != nil {
		return false, 0, 0, err
	}
	newCards := 0
	newReviews := 0
	desiredCardIDs := map[string]struct{}{}
	importedSetIDs := uniqueSortedStrings(append(append([]string(nil), previousConfig.ReviewSetIDs...),
		importConfig.ReviewSetIDs...))
	for _, importedCard := range noteCards {
		templateID := templateForCard[importedCard.ID]
		variantKey := "anki-card:" + strconv.FormatInt(importedCard.ID, 10)
		cardID := GeneratedCardID(sourceID, templateID, variantKey)
		desiredCardIDs[cardID] = struct{}{}
		setID := definitions.reviewSets[importedCard.DeckID]
		variantData, _ := CanonicalJSON(map[string]any{"ankiCardID": importedCard.ID, "ord": importedCard.Ord,
			"reviewSetID": setID})
		card := Card{ID: cardID, SourceID: sourceID, TemplateID: templateID, VariantKey: variantKey,
			VariantData: variantData, GenerationStatus: GenerationActive, Flag: importedCard.Flags & 7,
			CreatedAt: request.ImportedAt, UpdatedAt: request.ImportedAt}
		cardRevision, cardFound, cardErr := store.projection.CurrentEntity(ctx, EntityCard, cardID)
		if cardErr != nil {
			return false, 0, 0, cardErr
		}
		if cardFound && !cardRevision.Deleted {
			var preserved Card
			if err = decodeStrictJSON(cardRevision.Payload, &preserved); err != nil {
				return false, 0, 0, err
			}
			card.CreatedAt = preserved.CreatedAt
			card.UpdatedAt = preserved.UpdatedAt
			card.Flag = preserved.Flag
			card.PresetOverrideID = preserved.PresetOverrideID
			card.PriorityOverride = preserved.PriorityOverride
			if !sameEntityPayload(preserved, card) {
				card.UpdatedAt = request.ImportedAt
			}
			if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt, EntityCard,
				cardID, card, false); err != nil {
				return false, 0, 0, err
			}
		} else {
			newCards++
			if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt, EntityCard,
				cardID, card, false); err != nil {
				return false, 0, 0, err
			}
		}
		stateRevision, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
		if stateErr != nil {
			return false, 0, 0, stateErr
		}
		if !stateFound || stateRevision.Deleted {
			state := ankiInitialReviewState(cardID, importedCard, data.Preview.CollectionCrt,
				request.ImportedAt, reviewsByCard[importedCard.ID], operationID)
			if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
				EntityReviewState, cardID, state, false); err != nil {
				return false, 0, 0, err
			}
		}
		membershipID := DeterministicID("anki-review-set-membership", setID, cardID)
		membership := ReviewSetMembership{ID: membershipID, ReviewSetID: setID, CardID: cardID,
			Mode: MembershipInclude}
		if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
			EntityReviewSetMembership, membershipID, membership, true); err != nil {
			return false, 0, 0, err
		}
		for _, oldSetID := range importedSetIDs {
			if oldSetID == setID {
				continue
			}
			if err = store.appendAnkiEntityDeletion(ctx, &changes, operationID, request.ImportedAt,
				EntityReviewSetMembership, DeterministicID("anki-review-set-membership", oldSetID, cardID)); err != nil {
				return false, 0, 0, err
			}
		}
		for _, review := range reviewsByCard[importedCard.ID] {
			event, valid := ankiReviewEvent(data.Preview.CollectionID, sourceID, cardID, importedCard.ID, review)
			if !valid {
				continue
			}
			exists, eventErr := store.projection.eventExists(ctx, event.EventID)
			if eventErr != nil {
				return false, 0, 0, eventErr
			}
			if !exists {
				changes = append(changes, Change{Kind: RecordEvent, Event: &event})
				newReviews++
			}
		}
	}
	existingCards, err := store.projection.cardRevisionsBySource(ctx, sourceID)
	if err != nil {
		return false, 0, 0, err
	}
	for _, revision := range existingCards {
		if _, desired := desiredCardIDs[revision.EntityID]; desired {
			continue
		}
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			return false, 0, 0, err
		}
		if card.GenerationStatus != GenerationDeleted {
			card.GenerationStatus = GenerationDeleted
			card.UpdatedAt = request.ImportedAt
			if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt, EntityCard,
				card.ID, card, false); err != nil {
				return false, 0, 0, err
			}
		}
		for _, oldSetID := range importedSetIDs {
			if err = store.appendAnkiEntityDeletion(ctx, &changes, operationID, request.ImportedAt,
				EntityReviewSetMembership, DeterministicID("anki-review-set-membership", oldSetID, card.ID)); err != nil {
				return false, 0, 0, err
			}
		}
	}
	for _, tagID := range tagIDs {
		assignmentID := DeterministicID("tag-assignment", tagID, "source", sourceID)
		assignment := TagAssignment{ID: assignmentID, TagID: tagID, TargetType: "source", TargetID: sourceID}
		if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
			EntityTagAssignment, assignmentID, assignment, true); err != nil {
			return false, 0, 0, err
		}
	}
	currentTagIDs := make(map[string]struct{}, len(tagIDs))
	for _, tagID := range tagIDs {
		currentTagIDs[tagID] = struct{}{}
	}
	for _, oldTagID := range previousConfig.TagIDs {
		if _, current := currentTagIDs[oldTagID]; current {
			continue
		}
		assignmentID := DeterministicID("tag-assignment", oldTagID, "source", sourceID)
		if err = store.appendAnkiEntityDeletion(ctx, &changes, operationID, request.ImportedAt,
			EntityTagAssignment, assignmentID); err != nil {
			return false, 0, 0, err
		}
	}
	if len(changes) == 0 {
		return sourceFound, len(noteCards), 0, nil
	}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return false, 0, 0, err
	}
	if _, err = store.Apply(ctx, operationID, changes); err != nil {
		return false, 0, 0, err
	}
	return sourceFound, len(noteCards), newReviews, nil
}

func (store *Store) appendAnkiEntityChange(ctx context.Context, changes *[]Change, operationID string,
	updatedAt int64, entityType EntityType, entityID string, payload any, preserveExisting bool) error {
	encoded, err := CanonicalJSON(payload)
	if err != nil {
		return err
	}
	current, found, err := store.projection.CurrentEntity(ctx, entityType, entityID)
	if err != nil {
		return err
	}
	if found && !current.Deleted && (preserveExisting || string(current.Payload) == string(encoded)) {
		return nil
	}
	parents := []string(nil)
	if found {
		parents = []string{current.RevisionID}
	}
	revision, err := NewOperationEntityRevision(operationID, entityType, entityID, parents, updatedAt, false,
		json.RawMessage(encoded))
	if err != nil {
		return err
	}
	*changes = append(*changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	return nil
}

func (store *Store) appendAnkiEntityDeletion(ctx context.Context, changes *[]Change, operationID string,
	updatedAt int64, entityType EntityType, entityID string) error {
	current, found, err := store.projection.CurrentEntity(ctx, entityType, entityID)
	if err != nil || !found || current.Deleted {
		return err
	}
	revision, err := NewOperationEntityRevision(operationID, entityType, entityID,
		[]string{current.RevisionID}, updatedAt, true, json.RawMessage(`{}`))
	if err != nil {
		return err
	}
	*changes = append(*changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	return nil
}

func (store *Store) retireMissingAnkiSources(ctx context.Context, request AnkiImportRequest,
	data ankiImportPackage, written map[string]AnkiWrittenNote) (int, error) {
	rows, err := store.projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id, e.updated_at, e.payload
		FROM card_sources s JOIN entities e ON e.entity_type = ? AND e.entity_id = s.id
		WHERE s.source_type = 'anki' AND e.deleted = 0 ORDER BY s.id`, EntityCardSource)
	if err != nil {
		return 0, err
	}
	sources, err := scanCurrentRevisions(rows, EntityCardSource)
	if err != nil {
		return 0, err
	}
	retired := 0
	for _, sourceRevision := range sources {
		if err = ctx.Err(); err != nil {
			return retired, err
		}
		if _, exists := written[sourceRevision.EntityID]; exists {
			continue
		}
		var source CardSource
		if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
			return retired, err
		}
		var config ImportedGenerationConfig
		if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return retired, err
		}
		if config.CollectionID != data.Preview.CollectionID || source.Status == "deleted" {
			continue
		}
		operationID := request.OperationID + ":retired:" + source.ID
		if _, found, applyErr := store.findAppliedOperation(ctx, operationID); applyErr != nil {
			return retired, applyErr
		} else if found {
			continue
		}
		changes := make([]Change, 0)
		source.Status = "deleted"
		if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
			EntityCardSource, source.ID, source, false); err != nil {
			return retired, err
		}
		cards, cardErr := store.projection.cardRevisionsBySource(ctx, source.ID)
		if cardErr != nil {
			return retired, cardErr
		}
		for _, cardRevision := range cards {
			var card Card
			if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
				return retired, err
			}
			if card.GenerationStatus != GenerationDeleted {
				card.GenerationStatus = GenerationDeleted
				card.UpdatedAt = request.ImportedAt
				if err = store.appendAnkiEntityChange(ctx, &changes, operationID, request.ImportedAt,
					EntityCard, card.ID, card, false); err != nil {
					return retired, err
				}
			}
			for _, setID := range config.ReviewSetIDs {
				membershipID := DeterministicID("anki-review-set-membership", setID, card.ID)
				if err = store.appendAnkiEntityDeletion(ctx, &changes, operationID, request.ImportedAt,
					EntityReviewSetMembership, membershipID); err != nil {
					return retired, err
				}
			}
		}
		for _, tagID := range config.TagIDs {
			assignmentID := DeterministicID("tag-assignment", tagID, "source", source.ID)
			if err = store.appendAnkiEntityDeletion(ctx, &changes, operationID, request.ImportedAt,
				EntityTagAssignment, assignmentID); err != nil {
				return retired, err
			}
		}
		if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
			return retired, err
		}
		if _, err = store.Apply(ctx, operationID, changes); err != nil {
			return retired, err
		}
		retired++
	}
	return retired, nil
}

func ankiSourceID(collectionID string, note ankiImportNote) string {
	identity := strings.TrimSpace(note.GUID)
	if identity == "" {
		identity = "note:" + strconv.FormatInt(note.ID, 10)
	}
	return DeterministicID("anki-source", collectionID, identity)
}

func ankiFieldID(collectionID string, modelID int64, ord int) string {
	return DeterministicID("anki-field", collectionID, strconv.FormatInt(modelID, 10), strconv.Itoa(ord))
}

func ankiTemplateFieldIDs(collectionID string, model ankiModel, format string) []string {
	fieldNames := map[string]struct{}{}
	for _, match := range ankiTemplateFieldPattern.FindAllStringSubmatch(format, -1) {
		name := strings.TrimSpace(strings.TrimLeft(match[1], "#^/"))
		if separator := strings.LastIndex(name, ":"); separator >= 0 {
			name = strings.TrimSpace(name[separator+1:])
		}
		if name != "" {
			fieldNames[name] = struct{}{}
		}
	}
	ret := make([]string, 0)
	for _, field := range model.Flds {
		if _, referenced := fieldNames[field.Name]; referenced {
			ret = append(ret, ankiFieldID(collectionID, model.ID, field.Ord))
		}
	}
	if len(ret) == 0 && len(model.Flds) != 0 {
		ret = append(ret, ankiFieldID(collectionID, model.ID, model.Flds[0].Ord))
	}
	return ret
}

var ankiTemplateFieldPattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

func safeAnkiTemplateMarkup(value string, mediaPaths map[string]string) string {
	value = rewriteAnkiMediaReferences(value, mediaPaths)
	policy := bluemonday.UGCPolicy()
	policy.AllowElements("audio", "source")
	policy.AllowAttrs("controls", "preload", "src").OnElements("audio")
	policy.AllowAttrs("src", "type").OnElements("source")
	policy.AllowRelativeURLs(true)
	return strings.TrimSpace(policy.Sanitize(value))
}

func safeAnkiTemplateStyle(value string, mediaPaths map[string]string) string {
	for originalName, storedPath := range mediaPaths {
		encodedName := url.PathEscape(originalName)
		for _, name := range []string{originalName, encodedName} {
			for _, quote := range []string{"\"", "'", ""} {
				value = strings.ReplaceAll(value, "url("+quote+name+quote+")",
					"url("+quote+storedPath+quote+")")
			}
		}
	}
	return strings.TrimSpace(value)
}

func normalizedAnkiTagPath(name string) string {
	parts := strings.Split(name, "::")
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := NormalizeTagName(part); value != "" {
			normalized = append(normalized, value)
		}
	}
	return strings.Join(normalized, "::")
}

func ankiInitialReviewState(cardID string, card ankiImportCard, collectionCrt, importedAt int64,
	reviews []ankiImportReview, operationID string) ReviewState {
	state := "new"
	switch card.Type {
	case 1:
		state = "learning"
	case 2:
		state = "review"
	case 3:
		state = "relearning"
	}
	due := importedAt
	if card.Queue == 1 || card.Queue == 3 || card.Queue == 4 {
		due = card.Due * 1000
	} else if state == "review" && card.Due >= 0 {
		due = (collectionCrt + card.Due*86400) * 1000
	}
	if due <= 0 {
		due = importedAt
	}
	lastReview := int64(0)
	for _, review := range reviews {
		lastReview = maxInt64(lastReview, review.ID)
	}
	interval := uint64(maxInt64(0, card.Interval))
	stability := float64(interval)
	if state == "new" {
		stability = 0
	}
	buriedUntil := int64(0)
	buriedReason := ""
	if card.Queue == -2 || card.Queue == -3 {
		buriedUntil = importedAt + 86400000
		buriedReason = "anki"
	}
	return ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{
		State: state, Due: due, LastReview: lastReview, Stability: stability, Difficulty: 5,
		ScheduledDays: interval, Reps: uint64(maxInt64(0, card.Reps)), Lapses: uint64(maxInt64(0, card.Lapses)),
		Suspended: card.Queue == -1, BuriedUntil: buriedUntil, BuriedReason: buriedReason,
		StateRevisionID: OperationRevisionID(operationID, EntityReviewState, cardID),
	}}
}

func ankiReviewEvent(collectionID, sourceID, cardID string, originCardID int64,
	review ankiImportReview) (Event, bool) {
	rating := ReviewRating("")
	switch review.Ease {
	case 1:
		rating = ReviewAgain
	case 2:
		rating = ReviewHard
	case 3:
		rating = ReviewGood
	case 4:
		rating = ReviewEasy
	default:
		return Event{}, false
	}
	duration := maxInt64(0, review.DurationMS)
	input, _ := CanonicalJSON(map[string]any{"anki": map[string]any{
		"ease": review.Ease, "factor": review.Factor, "interval": review.Interval,
		"lastInterval": review.LastInterval, "type": review.Type,
	}})
	payload := ReviewEventPayload{CardID: cardID, SourceID: sourceID,
		OriginCardID: strconv.FormatInt(originCardID, 10), Kind: "review", Rating: rating,
		ReviewedAt: review.ID, DurationMS: &duration, SchedulerVersion: "legacy-unknown",
		PresetRevisionID: "legacy-unknown", SchedulerInput: input, ReviewMode: "normal"}
	payloadJSON, err := CanonicalJSON(payload)
	if err != nil {
		return Event{}, false
	}
	event := Event{EventType: EventReview,
		EventID: DeterministicID("anki-review-event", collectionID, strconv.FormatInt(review.ID, 10),
			strconv.FormatInt(originCardID, 10)),
		EntityID: cardID, OccurredAt: review.ID, Payload: payloadJSON}
	return event, event.Validate() == nil
}

func (projection *Projection) eventExists(ctx context.Context, eventID string) (bool, error) {
	var found int
	if err := projection.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM events WHERE event_id = ?)",
		eventID).Scan(&found); err != nil {
		return false, err
	}
	return found != 0, nil
}

func countAnkiReviews(cards []ankiImportCard, reviews map[int64][]ankiImportReview) int {
	count := 0
	for _, card := range cards {
		count += len(reviews[card.ID])
	}
	return count
}
