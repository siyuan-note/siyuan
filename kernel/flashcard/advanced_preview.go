// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import "errors"

// PreviewAdvancedSource 仅构造内存模型，不打开存储或创建内置实体。
func PreviewAdvancedSource(request AdvancedSourceRequest) ([]CardRenderModel, error) {
	if len(request.BlockIDs) > 1000 || request.DistractorQuery != nil || request.DynamicDistractors != 0 {
		return nil, errors.New("draft preview supports at most 1000 static blocks and no dynamic distractors")
	}
	if err := request.validateDraft(); err != nil {
		return nil, err
	}
	source, references, template, err := buildAdvancedSource(request)
	if err != nil {
		return nil, err
	}
	variants, err := EnumerateCardVariants(source, template)
	if err != nil {
		return nil, err
	}
	if len(variants) > 1000 {
		return nil, errors.New("draft preview exceeds 1000 variants")
	}
	entities, err := advancedEntityPayloads()
	if err != nil {
		return nil, err
	}
	var schema CardSchema
	for _, entity := range entities {
		if entity.EntityType == EntityCardSchema && entity.EntityID == source.SchemaID {
			if err = decodeStrictJSON(entity.Payload, &schema); err != nil {
				return nil, err
			}
			break
		}
	}
	models := make([]CardRenderModel, 0, len(variants))
	for _, variant := range variants {
		id := GeneratedCardID(source.ID, template.ID, variant.Key)
		models = append(models, CardRenderModel{Card: Card{ID: id, SourceID: source.ID,
			TemplateID: template.ID, VariantKey: variant.Key, VariantData: variant.Data,
			GenerationStatus: GenerationActive}, Source: source, References: references,
			Template: template, Schema: schema, ReviewState: ReviewState{CardID: id,
				ReviewStateSnapshot: ReviewStateSnapshot{State: "new"}}})
	}
	return models, nil
}
