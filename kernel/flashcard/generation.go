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
	"math"
	"sort"
	"strings"
)

const (
	GenerationStatic        = "static"
	GenerationClozeGroups   = "clozeGroups"
	GenerationOrderedSingle = "orderedSingle"
	GenerationOrderedCards  = "orderedCards"
	GenerationImageGroups   = "imageGroups"
	GenerationImported      = "importedVariants"
)

// GenerationRule 是模板允许执行的声明式生成规则。
type GenerationRule struct {
	Mode        string          `json:"mode"`
	VariantKey  string          `json:"variantKey,omitempty"`
	VariantData json.RawMessage `json:"variantData,omitempty"`
}

// ClozeGenerationConfig 保存稳定挖空、分组和组合变体。
type ClozeGenerationConfig struct {
	Occlusions []ClozeOcclusion `json:"occlusions"`
	Groups     []ClozeGroup     `json:"groups"`
	Variants   []ClozeVariant   `json:"variants,omitempty"`
}

// ClozeOcclusion 允许一个稳定挖空属于多个分组。
type ClozeOcclusion struct {
	ID           string   `json:"id"`
	GroupIDs     []string `json:"groupIDs"`
	DisplayOrder int      `json:"displayOrder"`
}

// ClozeGroup 保存显示顺序，不使用顺序作为卡片身份。
type ClozeGroup struct {
	ID           string `json:"id"`
	DisplayOrder int    `json:"displayOrder"`
}

// ClozeVariant 保存一个或多个分组组成的稳定卡片变体。
type ClozeVariant struct {
	ID       string   `json:"id"`
	GroupIDs []string `json:"groupIDs"`
	Mode     string   `json:"mode"`
}

// OrderedGenerationConfig 保存有序多空中的稳定步骤。
type OrderedGenerationConfig struct {
	Steps []OrderedStep `json:"steps"`
}

// OrderedStep 的 ID 是身份，DisplayOrder 只决定展示顺序。
type OrderedStep struct {
	ID             string          `json:"id"`
	DisplayOrder   int             `json:"displayOrder"`
	OcclusionIDs   []string        `json:"occlusionIDs"`
	Hint           string          `json:"hint,omitempty"`
	AnswerConfig   json.RawMessage `json:"answerConfig,omitempty"`
	RevealBehavior string          `json:"revealBehavior,omitempty"`
}

// ImageOcclusionConfig 保存归一化几何形状和稳定遮挡组。
type ImageOcclusionConfig struct {
	AssetID   string                `json:"assetID"`
	Shapes    []ImageOcclusionShape `json:"shapes"`
	Groups    []ImageOcclusionGroup `json:"groups"`
	FrontMode string                `json:"frontMode"`
}

// ImageOcclusionShape 支持矩形、椭圆和多边形。
type ImageOcclusionShape struct {
	ID     string                `json:"id"`
	Type   string                `json:"type"`
	X      float64               `json:"x,omitempty"`
	Y      float64               `json:"y,omitempty"`
	Width  float64               `json:"width,omitempty"`
	Height float64               `json:"height,omitempty"`
	Points []ImageOcclusionPoint `json:"points,omitempty"`
}

// ImageOcclusionPoint 使用相对于原图宽高的归一化坐标。
type ImageOcclusionPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// ImageOcclusionGroup 允许多个形状形成一张稳定遮挡卡。
type ImageOcclusionGroup struct {
	ID           string   `json:"id"`
	ShapeIDs     []string `json:"shapeIDs"`
	DisplayOrder int      `json:"displayOrder"`
}

// ChoiceGenerationConfig 保存固定选择题的稳定选项、正确答案和随机顺序策略。
type ChoiceGenerationConfig struct {
	Mode                   string         `json:"mode"`
	Options                []ChoiceOption `json:"options"`
	CorrectOptionIDs       []string       `json:"correctOptionIDs"`
	Randomize              bool           `json:"randomize"`
	DistractorQuery        *QueryAST      `json:"distractorQuery,omitempty"`
	DynamicDistractorCount int            `json:"dynamicDistractorCount,omitempty"`
}

// ChoiceOption 使用独立于显示顺序的 ID 标识一个固定选项。
type ChoiceOption struct {
	ID           string `json:"id"`
	DisplayOrder int    `json:"displayOrder"`
}

// MultiLineGenerationConfig 保存多行卡的稳定答案行和揭示方式。
type MultiLineGenerationConfig struct {
	Answers    []MultiLineAnswer `json:"answers"`
	RevealMode string            `json:"revealMode"`
}

// MultiLineAnswer 使用独立于显示顺序的 ID 标识一行答案。
type MultiLineAnswer struct {
	ID           string `json:"id"`
	DisplayOrder int    `json:"displayOrder"`
}

// ImportedGenerationConfig 保存外部卡包中已经实例化的稳定模板变体。
type ImportedGenerationConfig struct {
	CollectionID  string            `json:"collectionID,omitempty"`
	CollectionCrt int64             `json:"collectionCrt,omitempty"`
	NoteID        int64             `json:"noteID,omitempty"`
	GUID          string            `json:"guid,omitempty"`
	ModelID       int64             `json:"modelID,omitempty"`
	ReviewSetIDs  []string          `json:"reviewSetIDs,omitempty"`
	TagIDs        []string          `json:"tagIDs,omitempty"`
	Variants      []ImportedVariant `json:"variants"`
}

// ImportedVariant 将一个外部卡片身份映射到导入后的模板和安全回退数据。
type ImportedVariant struct {
	TemplateID string          `json:"templateID"`
	Key        string          `json:"key"`
	Data       json.RawMessage `json:"data,omitempty"`
}

// GeneratedVariant 是生成器交给协调器的稳定模板变体。
type GeneratedVariant struct {
	Key  string          `json:"key"`
	Data json.RawMessage `json:"data,omitempty"`
}

// ReconcileResult 描述一次协调对卡片实体的影响。
type ReconcileResult struct {
	Batch     *OperationBatch `json:"batch,omitempty"`
	Created   []string        `json:"created"`
	Updated   []string        `json:"updated"`
	Unchanged []string        `json:"unchanged"`
}

// GeneratedCardID 根据卡源、模板和稳定变体键生成跨设备一致的卡片 ID。
func GeneratedCardID(sourceID, templateID, variantKey string) string {
	return DeterministicID("generated-card", sourceID, templateID, variantKey)
}

// ParseGenerationRule 严格解析模板生成规则。
func ParseGenerationRule(data []byte) (GenerationRule, error) {
	var rule GenerationRule
	if err := decodeStrictJSON(data, &rule); err != nil {
		return GenerationRule{}, fmt.Errorf("decode flashcard generation rule: %w", err)
	}
	if err := rule.validate(); err != nil {
		return GenerationRule{}, err
	}
	return rule, nil
}

func (rule *GenerationRule) validate() error {
	switch rule.Mode {
	case GenerationStatic:
		if strings.TrimSpace(rule.VariantKey) == "" {
			return errors.New("static flashcard generation requires a variant key")
		}
	case GenerationClozeGroups, GenerationOrderedCards, GenerationImageGroups, GenerationImported:
		if rule.VariantKey != "" {
			return fmt.Errorf("flashcard generation mode [%s] must not define a fixed variant key", rule.Mode)
		}
	case GenerationOrderedSingle:
		if strings.TrimSpace(rule.VariantKey) == "" {
			return errors.New("single-card ordered generation requires a variant key")
		}
	default:
		return fmt.Errorf("unsupported flashcard generation mode [%s]", rule.Mode)
	}
	return validateOptionalJSON("flashcard generation variant data", rule.VariantData)
}

// EnumerateCardVariants 根据模板规则和类型化卡源配置生成稳定变体。
func EnumerateCardVariants(source CardSource, template CardTemplate) ([]GeneratedVariant, error) {
	rule, err := ParseGenerationRule(template.GenerationRule)
	if err != nil {
		return nil, err
	}
	switch rule.Mode {
	case GenerationStatic:
		data, err := mergeVariantData(rule.VariantData, map[string]any{"mode": GenerationStatic})
		if err != nil {
			return nil, err
		}
		return []GeneratedVariant{{Key: rule.VariantKey, Data: data}}, nil
	case GenerationClozeGroups:
		var config ClozeGenerationConfig
		if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return nil, fmt.Errorf("decode cloze generation config: %w", err)
		}
		if err = config.validate(); err != nil {
			return nil, err
		}
		return enumerateClozeVariants(config)
	case GenerationOrderedSingle, GenerationOrderedCards:
		var config OrderedGenerationConfig
		if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return nil, fmt.Errorf("decode ordered generation config: %w", err)
		}
		if err = config.validate(); err != nil {
			return nil, err
		}
		return enumerateOrderedVariants(config, rule)
	case GenerationImageGroups:
		var config ImageOcclusionConfig
		if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return nil, fmt.Errorf("decode image occlusion config: %w", err)
		}
		if err = config.validate(); err != nil {
			return nil, err
		}
		return enumerateImageVariants(config)
	case GenerationImported:
		var config ImportedGenerationConfig
		if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return nil, fmt.Errorf("decode imported generation config: %w", err)
		}
		if err = config.validate(); err != nil {
			return nil, err
		}
		return enumerateImportedVariants(config, template.ID)
	default:
		return nil, fmt.Errorf("unsupported flashcard generation mode [%s]", rule.Mode)
	}
}

func (config *ImportedGenerationConfig) validate() error {
	if len(config.Variants) == 0 {
		return errors.New("imported flashcard generation requires variants")
	}
	identities := map[string]struct{}{}
	for _, variant := range config.Variants {
		if strings.TrimSpace(variant.TemplateID) == "" || strings.TrimSpace(variant.Key) == "" {
			return errors.New("imported flashcard variant identity is incomplete")
		}
		identity := variant.TemplateID + "\x00" + variant.Key
		if _, duplicate := identities[identity]; duplicate {
			return fmt.Errorf("duplicate imported flashcard variant [%s:%s]", variant.TemplateID, variant.Key)
		}
		identities[identity] = struct{}{}
		if err := validateOptionalJSON("imported flashcard variant data", variant.Data); err != nil {
			return err
		}
	}
	if err := validateUniqueStrings("imported flashcard review set IDs", config.ReviewSetIDs, false); err != nil {
		return err
	}
	if err := validateUniqueStrings("imported flashcard tag IDs", config.TagIDs, false); err != nil {
		return err
	}
	return nil
}

func enumerateImportedVariants(config ImportedGenerationConfig, templateID string) ([]GeneratedVariant, error) {
	ret := make([]GeneratedVariant, 0)
	for _, variant := range config.Variants {
		if variant.TemplateID == templateID {
			ret = append(ret, GeneratedVariant{Key: variant.Key, Data: variant.Data})
		}
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].Key < ret[j].Key })
	return ret, nil
}

// ReconcileSourceCards 在一个权威批次和 SQLite 事务中协调卡片及新卡状态。
func (store *Store) ReconcileSourceCards(ctx context.Context, operationID, sourceID string,
	updatedAt int64) (ReconcileResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReconcileResult{}, errors.New("flashcard store is closed")
	}
	if existingBatch, exists, err := store.findAppliedOperationLocked(ctx, operationID); err != nil {
		return ReconcileResult{}, err
	} else if exists {
		return reconcileResultFromBatch(existingBatch, sourceID, updatedAt)
	}
	sourceRevision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil {
		return ReconcileResult{}, err
	}
	if !found || sourceRevision.Deleted {
		return ReconcileResult{}, errors.New("flashcard source was not found")
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		return ReconcileResult{}, err
	}
	templates, err := store.projection.templateRevisionsBySchema(ctx, source.SchemaID)
	if err != nil {
		return ReconcileResult{}, err
	}
	existing, err := store.projection.cardRevisionsBySource(ctx, sourceID)
	if err != nil {
		return ReconcileResult{}, err
	}
	desired := map[string]Card{}
	disabledTemplates := map[string]struct{}{}
	for _, templateID := range source.DisabledTemplateIDs {
		disabledTemplates[templateID] = struct{}{}
	}
	for _, templateRevision := range templates {
		var template CardTemplate
		if err = decodeStrictJSON(templateRevision.Payload, &template); err != nil {
			return ReconcileResult{}, err
		}
		_, sourceDisabled := disabledTemplates[template.ID]
		if !template.Enabled || sourceDisabled {
			disabledTemplates[template.ID] = struct{}{}
			continue
		}
		if source.Status == "deleted" {
			continue
		}
		variants, variantsErr := EnumerateCardVariants(source, template)
		if variantsErr != nil {
			return ReconcileResult{}, variantsErr
		}
		for _, variant := range variants {
			key := cardVariantMapKey(template.ID, variant.Key)
			if _, duplicate := desired[key]; duplicate {
				return ReconcileResult{}, fmt.Errorf("duplicate generated flashcard variant [%s]", key)
			}
			status := GenerationActive
			if source.Status == "orphaned" {
				status = GenerationOrphaned
			}
			desired[key] = Card{
				ID:               GeneratedCardID(source.ID, template.ID, variant.Key),
				SourceID:         source.ID,
				TemplateID:       template.ID,
				VariantKey:       variant.Key,
				VariantData:      variant.Data,
				GenerationStatus: status,
				CreatedAt:        updatedAt,
				UpdatedAt:        updatedAt,
			}
		}
	}
	existingByKey := make(map[string]EntityRevision, len(existing))
	for _, revision := range existing {
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			return ReconcileResult{}, err
		}
		existingByKey[cardVariantMapKey(card.TemplateID, card.VariantKey)] = revision
	}
	var changes []Change
	result := ReconcileResult{}
	desiredKeys := make([]string, 0, len(desired))
	for key := range desired {
		desiredKeys = append(desiredKeys, key)
	}
	sort.Strings(desiredKeys)
	for _, key := range desiredKeys {
		card := desired[key]
		existingRevision, exists := existingByKey[key]
		if exists {
			var current Card
			if err = decodeStrictJSON(existingRevision.Payload, &current); err != nil {
				return ReconcileResult{}, err
			}
			card.ID = current.ID
			card.CreatedAt = current.CreatedAt
			card.Flag = current.Flag
			card.PresetOverrideID = current.PresetOverrideID
			card.PriorityOverride = current.PriorityOverride
			stateRevision, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, card.ID)
			if stateErr != nil {
				return ReconcileResult{}, stateErr
			}
			if !stateFound || stateRevision.Deleted {
				return ReconcileResult{}, fmt.Errorf("flashcard [%s] has no active review state", card.ID)
			}
			card.UpdatedAt = current.UpdatedAt
			if sameEntityPayload(current, card) {
				result.Unchanged = append(result.Unchanged, card.ID)
				delete(existingByKey, key)
				continue
			}
			card.UpdatedAt = updatedAt
			result.Updated = append(result.Updated, card.ID)
			revision, revisionErr := NewOperationEntityRevision(operationID, EntityCard, card.ID,
				[]string{existingRevision.RevisionID}, updatedAt, false, card)
			if revisionErr != nil {
				return ReconcileResult{}, revisionErr
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
			delete(existingByKey, key)
			continue
		}
		priorCard, priorFound, priorErr := store.projection.CurrentEntity(ctx, EntityCard, card.ID)
		if priorErr != nil {
			return ReconcileResult{}, priorErr
		}
		if priorFound {
			if priorCard.Deleted {
				result.Unchanged = append(result.Unchanged, card.ID)
				continue
			}
			return ReconcileResult{}, fmt.Errorf("flashcard [%s] is missing from its business projection", card.ID)
		}
		_, stateFound, stateErr := store.projection.CurrentEntity(ctx, EntityReviewState, card.ID)
		if stateErr != nil {
			return ReconcileResult{}, stateErr
		}
		if stateFound {
			return ReconcileResult{}, fmt.Errorf("new flashcard [%s] already has a review state", card.ID)
		}
		result.Created = append(result.Created, card.ID)
		cardRevision, revisionErr := NewOperationEntityRevision(operationID, EntityCard, card.ID, nil, updatedAt,
			false, card)
		if revisionErr != nil {
			return ReconcileResult{}, revisionErr
		}
		stateRevisionID := OperationRevisionID(operationID, EntityReviewState, card.ID)
		state := ReviewState{
			CardID: card.ID,
			ReviewStateSnapshot: ReviewStateSnapshot{
				State:           "new",
				Due:             updatedAt,
				StateRevisionID: stateRevisionID,
			},
		}
		stateRevision, revisionErr := NewOperationEntityRevision(operationID, EntityReviewState, card.ID, nil,
			updatedAt, false, state)
		if revisionErr != nil {
			return ReconcileResult{}, revisionErr
		}
		changes = append(changes,
			Change{Kind: RecordEntityRevision, Revision: &cardRevision},
			Change{Kind: RecordEntityRevision, Revision: &stateRevision})
	}
	remainingKeys := make([]string, 0, len(existingByKey))
	for key := range existingByKey {
		remainingKeys = append(remainingKeys, key)
	}
	sort.Strings(remainingKeys)
	for _, key := range remainingKeys {
		revision := existingByKey[key]
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			return ReconcileResult{}, err
		}
		status := GenerationDeleted
		if _, disabled := disabledTemplates[card.TemplateID]; disabled {
			status = GenerationDisabledByTemplate
		}
		if card.GenerationStatus == status {
			result.Unchanged = append(result.Unchanged, card.ID)
			continue
		}
		card.GenerationStatus = status
		card.UpdatedAt = updatedAt
		updatedRevision, revisionErr := NewOperationEntityRevision(operationID, EntityCard, card.ID,
			[]string{revision.RevisionID}, updatedAt, false, card)
		if revisionErr != nil {
			return ReconcileResult{}, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &updatedRevision})
		result.Updated = append(result.Updated, card.ID)
	}
	if len(changes) == 0 {
		return result, nil
	}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return ReconcileResult{}, err
	}
	batch, err := store.applyLocked(ctx, operationID, changes)
	if err != nil {
		return ReconcileResult{}, err
	}
	result.Batch = &batch
	return result, nil
}

func reconcileResultFromBatch(batch OperationBatch, sourceID string, updatedAt int64) (ReconcileResult, error) {
	result := ReconcileResult{Batch: &batch}
	cardChanges := 0
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil || change.Revision.EntityType != EntityCard {
			continue
		}
		var card Card
		if err := decodeStrictJSON(change.Revision.Payload, &card); err != nil {
			return ReconcileResult{}, err
		}
		if card.SourceID != sourceID {
			return ReconcileResult{}, ErrOperationConflict
		}
		if change.Revision.UpdatedAt != updatedAt {
			return ReconcileResult{}, ErrOperationConflict
		}
		cardChanges++
		if len(change.Revision.ParentRevisionIDs) == 0 {
			result.Created = append(result.Created, card.ID)
		} else {
			result.Updated = append(result.Updated, card.ID)
		}
	}
	if cardChanges == 0 {
		return ReconcileResult{}, ErrOperationConflict
	}
	return result, nil
}

func (config *ClozeGenerationConfig) validate() error {
	if len(config.Occlusions) == 0 || len(config.Groups) == 0 {
		return errors.New("cloze generation requires occlusions and groups")
	}
	groupIDs := map[string]struct{}{}
	groupOrders := map[int]struct{}{}
	for _, group := range config.Groups {
		if strings.TrimSpace(group.ID) == "" || group.DisplayOrder < 0 {
			return errors.New("cloze group identity and display order are invalid")
		}
		if _, duplicate := groupIDs[group.ID]; duplicate {
			return fmt.Errorf("duplicate cloze group ID [%s]", group.ID)
		}
		if _, duplicate := groupOrders[group.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate cloze group display order [%d]", group.DisplayOrder)
		}
		groupIDs[group.ID] = struct{}{}
		groupOrders[group.DisplayOrder] = struct{}{}
	}
	occlusionIDs := map[string]struct{}{}
	occlusionOrders := map[int]struct{}{}
	groupUse := map[string]int{}
	for _, occlusion := range config.Occlusions {
		if strings.TrimSpace(occlusion.ID) == "" || occlusion.DisplayOrder < 0 || len(occlusion.GroupIDs) == 0 {
			return errors.New("cloze occlusion identity, groups and display order are required")
		}
		if _, duplicate := occlusionIDs[occlusion.ID]; duplicate {
			return fmt.Errorf("duplicate cloze occlusion ID [%s]", occlusion.ID)
		}
		if _, duplicate := occlusionOrders[occlusion.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate cloze occlusion display order [%d]", occlusion.DisplayOrder)
		}
		if err := validateUniqueStrings("cloze occlusion group IDs", occlusion.GroupIDs, false); err != nil {
			return err
		}
		for _, groupID := range occlusion.GroupIDs {
			if _, found := groupIDs[groupID]; !found {
				return fmt.Errorf("cloze occlusion references unknown group [%s]", groupID)
			}
			groupUse[groupID]++
		}
		occlusionIDs[occlusion.ID] = struct{}{}
		occlusionOrders[occlusion.DisplayOrder] = struct{}{}
	}
	for groupID := range groupIDs {
		if groupUse[groupID] == 0 {
			return fmt.Errorf("cloze group [%s] has no occlusions", groupID)
		}
	}
	variantIDs := map[string]struct{}{}
	for _, variant := range config.Variants {
		if strings.TrimSpace(variant.ID) == "" || len(variant.GroupIDs) == 0 {
			return errors.New("cloze variant identity and groups are required")
		}
		if _, duplicate := variantIDs[variant.ID]; duplicate {
			return fmt.Errorf("duplicate cloze variant ID [%s]", variant.ID)
		}
		if variant.Mode != "hideGroups" && variant.Mode != "showGroups" {
			return fmt.Errorf("unsupported cloze variant mode [%s]", variant.Mode)
		}
		if err := validateUniqueStrings("cloze variant group IDs", variant.GroupIDs, false); err != nil {
			return err
		}
		for _, groupID := range variant.GroupIDs {
			if _, found := groupIDs[groupID]; !found {
				return fmt.Errorf("cloze variant references unknown group [%s]", groupID)
			}
		}
		variantIDs[variant.ID] = struct{}{}
	}
	return nil
}

func enumerateClozeVariants(config ClozeGenerationConfig) ([]GeneratedVariant, error) {
	if len(config.Variants) == 0 {
		groups := append([]ClozeGroup(nil), config.Groups...)
		sort.Slice(groups, func(i, j int) bool {
			if groups[i].DisplayOrder != groups[j].DisplayOrder {
				return groups[i].DisplayOrder < groups[j].DisplayOrder
			}
			return groups[i].ID < groups[j].ID
		})
		ret := make([]GeneratedVariant, 0, len(groups))
		for _, group := range groups {
			data, err := CanonicalJSON(map[string]any{"groupIDs": []string{group.ID}, "mode": "hideGroups"})
			if err != nil {
				return nil, err
			}
			ret = append(ret, GeneratedVariant{Key: "group:" + group.ID, Data: data})
		}
		return ret, nil
	}
	variants := append([]ClozeVariant(nil), config.Variants...)
	sort.Slice(variants, func(i, j int) bool { return variants[i].ID < variants[j].ID })
	ret := make([]GeneratedVariant, 0, len(variants))
	for _, variant := range variants {
		groups := append([]string(nil), variant.GroupIDs...)
		sort.Strings(groups)
		data, err := CanonicalJSON(map[string]any{"groupIDs": groups, "mode": variant.Mode})
		if err != nil {
			return nil, err
		}
		ret = append(ret, GeneratedVariant{Key: "variant:" + variant.ID, Data: data})
	}
	return ret, nil
}

func (config *OrderedGenerationConfig) validate() error {
	if len(config.Steps) == 0 {
		return errors.New("ordered flashcard generation requires steps")
	}
	stepIDs := map[string]struct{}{}
	orders := map[int]struct{}{}
	for _, step := range config.Steps {
		if strings.TrimSpace(step.ID) == "" || step.DisplayOrder < 0 || len(step.OcclusionIDs) == 0 {
			return errors.New("ordered flashcard step identity, occlusions and display order are required")
		}
		if _, duplicate := stepIDs[step.ID]; duplicate {
			return fmt.Errorf("duplicate ordered flashcard step ID [%s]", step.ID)
		}
		if _, duplicate := orders[step.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate ordered flashcard step display order [%d]", step.DisplayOrder)
		}
		if err := validateUniqueStrings("ordered step occlusion IDs", step.OcclusionIDs, false); err != nil {
			return err
		}
		if err := validateOptionalJSON("ordered step answer config", step.AnswerConfig); err != nil {
			return err
		}
		if step.RevealBehavior != "" && step.RevealBehavior != "replace" && step.RevealBehavior != "append" {
			return fmt.Errorf("unsupported ordered step reveal behavior [%s]", step.RevealBehavior)
		}
		stepIDs[step.ID] = struct{}{}
		orders[step.DisplayOrder] = struct{}{}
	}
	return nil
}

func enumerateOrderedVariants(config OrderedGenerationConfig, rule GenerationRule) ([]GeneratedVariant, error) {
	steps := append([]OrderedStep(nil), config.Steps...)
	sort.Slice(steps, func(i, j int) bool {
		if steps[i].DisplayOrder != steps[j].DisplayOrder {
			return steps[i].DisplayOrder < steps[j].DisplayOrder
		}
		return steps[i].ID < steps[j].ID
	})
	if rule.Mode == GenerationOrderedSingle {
		stepIDs := make([]string, 0, len(steps))
		for _, step := range steps {
			stepIDs = append(stepIDs, step.ID)
		}
		data, err := CanonicalJSON(map[string]any{"mode": "single", "stepIDs": stepIDs})
		if err != nil {
			return nil, err
		}
		return []GeneratedVariant{{Key: rule.VariantKey, Data: data}}, nil
	}
	ret := make([]GeneratedVariant, 0, len(steps))
	contextStepIDs := []string{}
	for _, step := range steps {
		data, err := CanonicalJSON(map[string]any{
			"contextStepIDs": append([]string(nil), contextStepIDs...),
			"mode":           "progressive",
			"stepID":         step.ID,
		})
		if err != nil {
			return nil, err
		}
		ret = append(ret, GeneratedVariant{Key: "step:" + step.ID, Data: data})
		contextStepIDs = append(contextStepIDs, step.ID)
	}
	return ret, nil
}

func (config *ImageOcclusionConfig) validate() error {
	if strings.TrimSpace(config.AssetID) == "" || len(config.Shapes) == 0 || len(config.Groups) == 0 {
		return errors.New("image occlusion asset, shapes and groups are required")
	}
	if config.FrontMode != "hideAllAnswerOne" && config.FrontMode != "hideCurrent" {
		return fmt.Errorf("unsupported image occlusion front mode [%s]", config.FrontMode)
	}
	shapeIDs := map[string]struct{}{}
	for _, shape := range config.Shapes {
		if strings.TrimSpace(shape.ID) == "" {
			return errors.New("image occlusion shape ID is required")
		}
		if _, duplicate := shapeIDs[shape.ID]; duplicate {
			return fmt.Errorf("duplicate image occlusion shape ID [%s]", shape.ID)
		}
		switch shape.Type {
		case "rectangle", "ellipse":
			if !normalizedCoordinate(shape.X) || !normalizedCoordinate(shape.Y) || !normalizedLength(shape.Width) ||
				!normalizedLength(shape.Height) || shape.X+shape.Width > 1 || shape.Y+shape.Height > 1 {
				return fmt.Errorf("image occlusion shape [%s] has invalid bounds", shape.ID)
			}
		case "polygon":
			if len(shape.Points) < 3 {
				return fmt.Errorf("image occlusion polygon [%s] requires at least three points", shape.ID)
			}
			for _, point := range shape.Points {
				if !normalizedCoordinate(point.X) || !normalizedCoordinate(point.Y) {
					return fmt.Errorf("image occlusion polygon [%s] has an invalid point", shape.ID)
				}
			}
		default:
			return fmt.Errorf("unsupported image occlusion shape type [%s]", shape.Type)
		}
		shapeIDs[shape.ID] = struct{}{}
	}
	groupIDs := map[string]struct{}{}
	orders := map[int]struct{}{}
	shapeUse := map[string]int{}
	for _, group := range config.Groups {
		if strings.TrimSpace(group.ID) == "" || group.DisplayOrder < 0 || len(group.ShapeIDs) == 0 {
			return errors.New("image occlusion group identity, shapes and display order are required")
		}
		if _, duplicate := groupIDs[group.ID]; duplicate {
			return fmt.Errorf("duplicate image occlusion group ID [%s]", group.ID)
		}
		if _, duplicate := orders[group.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate image occlusion group display order [%d]", group.DisplayOrder)
		}
		if err := validateUniqueStrings("image occlusion group shape IDs", group.ShapeIDs, false); err != nil {
			return err
		}
		for _, shapeID := range group.ShapeIDs {
			if _, found := shapeIDs[shapeID]; !found {
				return fmt.Errorf("image occlusion group references unknown shape [%s]", shapeID)
			}
			shapeUse[shapeID]++
		}
		groupIDs[group.ID] = struct{}{}
		orders[group.DisplayOrder] = struct{}{}
	}
	for shapeID := range shapeIDs {
		if shapeUse[shapeID] == 0 {
			return fmt.Errorf("image occlusion shape [%s] is not assigned to a group", shapeID)
		}
	}
	return nil
}

func (config *ChoiceGenerationConfig) validate() error {
	if config.Mode != "single" && config.Mode != "multiple" {
		return fmt.Errorf("unsupported flashcard choice mode [%s]", config.Mode)
	}
	if len(config.Options) < 2 || len(config.CorrectOptionIDs) == 0 {
		return errors.New("flashcard choice requires at least two options and one correct answer")
	}
	optionIDs := map[string]struct{}{}
	displayOrders := map[int]struct{}{}
	for _, option := range config.Options {
		if strings.TrimSpace(option.ID) == "" || option.DisplayOrder < 0 {
			return errors.New("flashcard choice option identity and display order are required")
		}
		if _, duplicate := optionIDs[option.ID]; duplicate {
			return fmt.Errorf("duplicate flashcard choice option [%s]", option.ID)
		}
		if _, duplicate := displayOrders[option.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate flashcard choice display order [%d]", option.DisplayOrder)
		}
		optionIDs[option.ID] = struct{}{}
		displayOrders[option.DisplayOrder] = struct{}{}
	}
	if err := validateUniqueStrings("flashcard correct choice option IDs", config.CorrectOptionIDs, false); err != nil {
		return err
	}
	for _, optionID := range config.CorrectOptionIDs {
		if _, found := optionIDs[optionID]; !found {
			return fmt.Errorf("flashcard choice references unknown correct option [%s]", optionID)
		}
	}
	if config.Mode == "single" && len(config.CorrectOptionIDs) != 1 {
		return errors.New("single-choice flashcard requires exactly one correct option")
	}
	if config.DynamicDistractorCount < 0 || config.DynamicDistractorCount > 50 {
		return errors.New("flashcard dynamic distractor count must be between zero and fifty")
	}
	if config.DynamicDistractorCount == 0 && config.DistractorQuery != nil {
		return errors.New("flashcard distractor query requires a positive distractor count")
	}
	if config.DynamicDistractorCount > 0 {
		if config.DistractorQuery == nil {
			return errors.New("dynamic flashcard distractors require a query")
		}
		if err := config.DistractorQuery.Validate(); err != nil {
			return fmt.Errorf("validate flashcard distractor query: %w", err)
		}
	}
	return nil
}

func (config *MultiLineGenerationConfig) validate() error {
	if config.RevealMode != "all" && config.RevealMode != "steps" {
		return fmt.Errorf("unsupported multi-line flashcard reveal mode [%s]", config.RevealMode)
	}
	if len(config.Answers) == 0 {
		return errors.New("multi-line flashcard requires at least one answer")
	}
	answerIDs := map[string]struct{}{}
	displayOrders := map[int]struct{}{}
	for _, answer := range config.Answers {
		if strings.TrimSpace(answer.ID) == "" || answer.DisplayOrder < 0 {
			return errors.New("multi-line flashcard answer identity and display order are required")
		}
		if _, duplicate := answerIDs[answer.ID]; duplicate {
			return fmt.Errorf("duplicate multi-line flashcard answer [%s]", answer.ID)
		}
		if _, duplicate := displayOrders[answer.DisplayOrder]; duplicate {
			return fmt.Errorf("duplicate multi-line flashcard answer display order [%d]", answer.DisplayOrder)
		}
		answerIDs[answer.ID] = struct{}{}
		displayOrders[answer.DisplayOrder] = struct{}{}
	}
	return nil
}

func enumerateImageVariants(config ImageOcclusionConfig) ([]GeneratedVariant, error) {
	groups := append([]ImageOcclusionGroup(nil), config.Groups...)
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].DisplayOrder != groups[j].DisplayOrder {
			return groups[i].DisplayOrder < groups[j].DisplayOrder
		}
		return groups[i].ID < groups[j].ID
	})
	ret := make([]GeneratedVariant, 0, len(groups))
	for _, group := range groups {
		shapeIDs := append([]string(nil), group.ShapeIDs...)
		sort.Strings(shapeIDs)
		data, err := CanonicalJSON(map[string]any{
			"frontMode": config.FrontMode,
			"groupID":   group.ID,
			"shapeIDs":  shapeIDs,
		})
		if err != nil {
			return nil, err
		}
		ret = append(ret, GeneratedVariant{Key: "group:" + group.ID, Data: data})
	}
	return ret, nil
}

func mergeVariantData(value json.RawMessage, required map[string]any) (json.RawMessage, error) {
	ret := map[string]any{}
	if len(value) != 0 {
		if err := decodeStrictJSON(value, &ret); err != nil {
			return nil, fmt.Errorf("decode static variant data: %w", err)
		}
	}
	for key, requiredValue := range required {
		if _, exists := ret[key]; exists {
			return nil, fmt.Errorf("static variant data must not override field [%s]", key)
		}
		ret[key] = requiredValue
	}
	return CanonicalJSON(ret)
}

func cardVariantMapKey(templateID, variantKey string) string {
	return templateID + "\x00" + variantKey
}

func sameEntityPayload(first, second any) bool {
	firstJSON, firstErr := CanonicalJSON(first)
	secondJSON, secondErr := CanonicalJSON(second)
	return firstErr == nil && secondErr == nil && string(firstJSON) == string(secondJSON)
}

func normalizedCoordinate(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}

func normalizedLength(value float64) bool {
	return normalizedCoordinate(value) && value > 0
}
