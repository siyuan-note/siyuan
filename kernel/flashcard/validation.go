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
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

var supportedEntityTypes = map[EntityType]struct{}{
	EntityCardSchema:          {},
	EntityCardTemplate:        {},
	EntityCardSource:          {},
	EntityCardSourceRef:       {},
	EntityCard:                {},
	EntityReviewState:         {},
	EntityReviewSet:           {},
	EntityReviewSetMembership: {},
	EntitySchedulerPreset:     {},
	EntityTag:                 {},
	EntityTagAssignment:       {},
	EntityStudyPolicy:         {},
	EntityStudySession:        {},
	EntitySessionCard:         {},
	EntityLegacyCardAlias:     {},
}

func validateEntityPayload(revision *EntityRevision) error {
	if _, ok := supportedEntityTypes[revision.EntityType]; !ok {
		return fmt.Errorf("unsupported flashcard entity type [%s]", revision.EntityType)
	}
	canonical, err := canonicalRawMessage(revision.Payload)
	if err != nil {
		return fmt.Errorf("canonicalize flashcard entity payload: %w", err)
	}
	if !bytes.Equal(canonical, revision.Payload) {
		return errors.New("flashcard entity payload is not canonical JSON")
	}
	if revision.Deleted {
		if !bytes.Equal(revision.Payload, []byte("{}")) {
			return errors.New("deleted flashcard entity payload must be an empty object")
		}
		return nil
	}
	switch revision.EntityType {
	case EntityCardSchema:
		var value CardSchema
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityCardTemplate:
		var value CardTemplate
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityCardSource:
		var value CardSource
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityCardSourceRef:
		var value CardSourceRef
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityCard:
		var value Card
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityReviewState:
		var value ReviewState
		if err := decodeAndValidateEntity(revision, &value, value.validate); err != nil {
			return err
		}
		if value.StateRevisionID != revision.RevisionID {
			return errors.New("review state revision ID does not match entity revision ID")
		}
		return nil
	case EntityReviewSet:
		var value ReviewSet
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityReviewSetMembership:
		var value ReviewSetMembership
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntitySchedulerPreset:
		var value SchedulerPreset
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityTag:
		var value Tag
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityTagAssignment:
		var value TagAssignment
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityStudyPolicy:
		var value StudyPolicy
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityStudySession:
		var value StudySession
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntitySessionCard:
		var value SessionCard
		return decodeAndValidateEntity(revision, &value, value.validate)
	case EntityLegacyCardAlias:
		var value LegacyCardAlias
		return decodeAndValidateEntity(revision, &value, value.validate)
	default:
		return fmt.Errorf("unsupported flashcard entity type [%s]", revision.EntityType)
	}
}

func decodeAndValidateEntity(revision *EntityRevision, target any, validate func(string) error) error {
	if err := decodeStrictJSON(revision.Payload, target); err != nil {
		return fmt.Errorf("decode flashcard entity [%s]: %w", revision.EntityType, err)
	}
	if err := validate(revision.EntityID); err != nil {
		return fmt.Errorf("validate flashcard entity [%s]: %w", revision.EntityType, err)
	}
	return nil
}

func validateRequiredID(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return nil
}

func validatePayloadID(expected, actual string) error {
	if err := validateRequiredID("entity payload ID", actual); err != nil {
		return err
	}
	if actual != expected {
		return errors.New("entity payload ID does not match entity ID")
	}
	return nil
}

func validateRequiredJSON(name string, value json.RawMessage) error {
	if len(value) == 0 || !json.Valid(value) || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return fmt.Errorf("%s must be non-null JSON", name)
	}
	return nil
}

func validateOptionalJSON(name string, value json.RawMessage) error {
	if len(value) != 0 && (!json.Valid(value) || bytes.Equal(bytes.TrimSpace(value), []byte("null"))) {
		return fmt.Errorf("%s must be non-null JSON when present", name)
	}
	return nil
}

func validateUniqueStrings(name string, values []string, allowEmpty bool) error {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !allowEmpty && strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s must not contain an empty value", name)
		}
		if _, ok := seen[value]; ok {
			return fmt.Errorf("%s contains duplicate value [%s]", name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func validateFiniteNonnegative(name string, value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return fmt.Errorf("%s must be a finite nonnegative number", name)
	}
	return nil
}

func (schema *CardSchema) validate(entityID string) error {
	if err := validatePayloadID(entityID, schema.ID); err != nil {
		return err
	}
	if strings.TrimSpace(schema.Name) == "" || len(schema.Fields) == 0 {
		return errors.New("card schema name and fields are required")
	}
	fieldIDs := make([]string, 0, len(schema.Fields))
	sorts := map[int]struct{}{}
	for _, field := range schema.Fields {
		if strings.TrimSpace(field.ID) == "" || strings.TrimSpace(field.Name) == "" || strings.TrimSpace(field.Type) == "" {
			return errors.New("card schema field identity is incomplete")
		}
		if field.Sort < 0 {
			return errors.New("card schema field sort must not be negative")
		}
		if _, ok := sorts[field.Sort]; ok {
			return fmt.Errorf("card schema contains duplicate field sort [%d]", field.Sort)
		}
		sorts[field.Sort] = struct{}{}
		fieldIDs = append(fieldIDs, field.ID)
	}
	if err := validateUniqueStrings("card schema field IDs", fieldIDs, false); err != nil {
		return err
	}
	if err := validateUniqueStrings("card schema template IDs", schema.TemplateIDs, false); err != nil {
		return err
	}
	if schema.CreatedAt < 0 || schema.UpdatedAt < schema.CreatedAt {
		return errors.New("card schema timestamps are invalid")
	}
	return nil
}

func (template *CardTemplate) validate(entityID string) error {
	if err := validatePayloadID(entityID, template.ID); err != nil {
		return err
	}
	if strings.TrimSpace(template.SchemaID) == "" || strings.TrimSpace(template.Name) == "" ||
		strings.TrimSpace(template.AnswerMode) == "" {
		return errors.New("card template identity is incomplete")
	}
	for name, value := range map[string]json.RawMessage{
		"card template generation rule":     template.GenerationRule,
		"card template front specification": template.FrontSpec,
		"card template back specification":  template.BackSpec,
	} {
		if err := validateRequiredJSON(name, value); err != nil {
			return err
		}
	}
	if _, err := ParseGenerationRule(template.GenerationRule); err != nil {
		return err
	}
	if len(template.Style) > 512*1024 {
		return errors.New("card template style exceeds its size limit")
	}
	return validateOptionalJSON("card template context policy", template.ContextPolicy)
}

func (source *CardSource) validate(entityID string) error {
	if err := validatePayloadID(entityID, source.ID); err != nil {
		return err
	}
	if strings.TrimSpace(source.SchemaID) == "" || strings.TrimSpace(source.SourceType) == "" ||
		strings.TrimSpace(source.PrimaryRefID) == "" {
		return errors.New("card source identity is incomplete")
	}
	if source.Status != "active" && source.Status != "orphaned" && source.Status != "deleted" {
		return fmt.Errorf("unsupported card source status [%s]", source.Status)
	}
	if err := validateRequiredJSON("card source generation config", source.GenerationConfig); err != nil {
		return err
	}
	switch source.SourceType {
	case "block", "multi-block", "qa", "av-row":
	case "cloze":
		var config ClozeGenerationConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode cloze generation config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	case "ordered":
		var config OrderedGenerationConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode ordered generation config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	case "image-occlusion":
		var config ImageOcclusionConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode image occlusion config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	case "choice":
		var config ChoiceGenerationConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode flashcard choice config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	case "multi-line":
		var config MultiLineGenerationConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode multi-line flashcard config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	case "anki":
		var config ImportedGenerationConfig
		if err := decodeStrictJSON(source.GenerationConfig, &config); err != nil {
			return fmt.Errorf("decode imported generation config: %w", err)
		}
		if err := config.validate(); err != nil {
			return err
		}
	default:
		if !strings.HasPrefix(source.SourceType, "plugin:") {
			return fmt.Errorf("unsupported card source type [%s]", source.SourceType)
		}
	}
	if err := validateOptionalJSON("card source plugin data", source.PluginData); err != nil {
		return err
	}
	if source.Priority != "" && !validStudyPriority(source.Priority) {
		return fmt.Errorf("unsupported card source priority [%s]", source.Priority)
	}
	if err := validateUniqueStrings("disabled card source template IDs", source.DisabledTemplateIDs, false); err != nil {
		return err
	}
	pluginFieldsPresent := source.PluginNamespace != "" || source.PluginDataVersion != 0 || len(source.PluginData) != 0
	if pluginFieldsPresent && (strings.TrimSpace(source.PluginNamespace) == "" || source.PluginDataVersion < 1 ||
		len(source.PluginData) == 0) {
		return errors.New("card source plugin data requires a namespace, positive version and payload")
	}
	if strings.HasPrefix(source.SourceType, "plugin:") && !pluginFieldsPresent {
		return errors.New("plugin card source requires versioned plugin data")
	}
	if strings.HasPrefix(source.SourceType, "plugin:") {
		if !strings.HasPrefix(source.SourceType, "plugin:"+source.PluginNamespace+":") ||
			strings.TrimSpace(strings.TrimPrefix(source.SourceType, "plugin:"+source.PluginNamespace+":")) == "" {
			return errors.New("plugin card source type does not match its namespace")
		}
		if len(source.PluginData) > 1024*1024 {
			return errors.New("plugin card source data exceeds one MiB")
		}
		var pluginData map[string]json.RawMessage
		if err := decodeStrictJSON(source.PluginData, &pluginData); err != nil {
			return fmt.Errorf("decode plugin card source data: %w", err)
		}
		var fallback string
		if err := json.Unmarshal(pluginData["textFallback"], &fallback); err != nil || strings.TrimSpace(fallback) == "" {
			return errors.New("plugin card source data requires a text fallback")
		}
	}
	return nil
}

func (ref *CardSourceRef) validate(entityID string) error {
	if err := validatePayloadID(entityID, ref.ID); err != nil {
		return err
	}
	if strings.TrimSpace(ref.SourceID) == "" || strings.TrimSpace(ref.EntityType) == "" ||
		strings.TrimSpace(ref.EntityID) == "" || strings.TrimSpace(ref.Role) == "" {
		return errors.New("card source reference identity is incomplete")
	}
	if ref.Sort < 0 {
		return errors.New("card source reference sort must not be negative")
	}
	return nil
}

func (card *Card) validate(entityID string) error {
	if err := validatePayloadID(entityID, card.ID); err != nil {
		return err
	}
	if strings.TrimSpace(card.SourceID) == "" || strings.TrimSpace(card.TemplateID) == "" ||
		strings.TrimSpace(card.VariantKey) == "" {
		return errors.New("card identity is incomplete")
	}
	if err := validateOptionalJSON("card variant data", card.VariantData); err != nil {
		return err
	}
	switch card.GenerationStatus {
	case GenerationActive, GenerationDisabledByTemplate, GenerationOrphaned, GenerationDeleted:
	default:
		return fmt.Errorf("unsupported card generation status [%s]", card.GenerationStatus)
	}
	if card.Flag < 0 || card.Flag > 7 {
		return errors.New("card flag must be between zero and seven")
	}
	if card.CreatedAt < 0 || card.UpdatedAt < card.CreatedAt {
		return errors.New("card timestamps are invalid")
	}
	if card.PriorityOverride != "" && !validStudyPriority(card.PriorityOverride) {
		return fmt.Errorf("unsupported card priority [%s]", card.PriorityOverride)
	}
	return nil
}

func (state *ReviewState) validate(entityID string) error {
	if err := validatePayloadID(entityID, state.CardID); err != nil {
		return err
	}
	return state.ReviewStateSnapshot.validate()
}

func (state *ReviewStateSnapshot) validate() error {
	switch state.State {
	case "new", "learning", "review", "relearning":
	default:
		return fmt.Errorf("unsupported review state [%s]", state.State)
	}
	if state.Due < 0 || state.LastReview < 0 || state.BuriedUntil < 0 {
		return errors.New("review state timestamps must not be negative")
	}
	if err := validateFiniteNonnegative("review state stability", state.Stability); err != nil {
		return err
	}
	if err := validateFiniteNonnegative("review state difficulty", state.Difficulty); err != nil {
		return err
	}
	return validateRequiredID("review state revision ID", state.StateRevisionID)
}

func (reviewSet *ReviewSet) validate(entityID string) error {
	if err := validatePayloadID(entityID, reviewSet.ID); err != nil {
		return err
	}
	if strings.TrimSpace(reviewSet.Name) == "" || reviewSet.NewLimit < 0 || reviewSet.ReviewLimit < 0 {
		return errors.New("review set name and nonnegative limits are required")
	}
	if reviewSet.DefaultReviewMode != "normal" && reviewSet.DefaultReviewMode != "reinforcement" {
		return fmt.Errorf("unsupported review set mode [%s]", reviewSet.DefaultReviewMode)
	}
	if len(reviewSet.QueryAST) != 0 {
		if _, err := ParseQueryAST(reviewSet.QueryAST); err != nil {
			return err
		}
	}
	return validateOptionalJSON("review set order", reviewSet.Order)
}

func (membership *ReviewSetMembership) validate(entityID string) error {
	if err := validatePayloadID(entityID, membership.ID); err != nil {
		return err
	}
	if strings.TrimSpace(membership.ReviewSetID) == "" || strings.TrimSpace(membership.CardID) == "" {
		return errors.New("review set membership identity is incomplete")
	}
	if membership.Mode != MembershipInclude && membership.Mode != MembershipExclude {
		return fmt.Errorf("unsupported review set membership mode [%s]", membership.Mode)
	}
	return nil
}

func (preset *SchedulerPreset) validate(entityID string) error {
	if err := validatePayloadID(entityID, preset.ID); err != nil {
		return err
	}
	if strings.TrimSpace(preset.Name) == "" || preset.RequestRetention <= 0 || preset.RequestRetention > 1 ||
		preset.MaximumInterval < 1 || preset.NewLimit < 0 || preset.ReviewLimit < 0 || preset.LeechThreshold < 0 {
		return errors.New("scheduler preset values are invalid")
	}
	if preset.SchedulerVersion != SchedulerVersionFSRS6 {
		return fmt.Errorf("unsupported scheduler version [%s]", preset.SchedulerVersion)
	}
	if len(preset.Weights) != 19 {
		return errors.New("FSRS-6 scheduler preset requires 19 weights")
	}
	for _, weight := range preset.Weights {
		if math.IsNaN(weight) || math.IsInf(weight, 0) {
			return errors.New("scheduler preset weights must be finite")
		}
	}
	if preset.LeechAction != "tag" && preset.LeechAction != "suspend" && preset.LeechAction != "tagAndSuspend" {
		return fmt.Errorf("unsupported scheduler preset leech action [%s]", preset.LeechAction)
	}
	return nil
}

func (tag *Tag) validate(entityID string) error {
	if err := validatePayloadID(entityID, tag.ID); err != nil {
		return err
	}
	if tag.ParentID == tag.ID {
		return errors.New("flashcard tag cannot be its own parent")
	}
	if strings.TrimSpace(tag.Name) == "" || strings.TrimSpace(tag.NormalizedName) == "" {
		return errors.New("flashcard tag name is required")
	}
	if tag.NormalizedName != NormalizeTagName(tag.Name) {
		return errors.New("flashcard tag normalized name is invalid")
	}
	return nil
}

func (assignment *TagAssignment) validate(entityID string) error {
	if err := validatePayloadID(entityID, assignment.ID); err != nil {
		return err
	}
	if strings.TrimSpace(assignment.TagID) == "" || strings.TrimSpace(assignment.TargetID) == "" {
		return errors.New("flashcard tag assignment identity is incomplete")
	}
	if assignment.TargetType != "source" && assignment.TargetType != "card" {
		return fmt.Errorf("unsupported flashcard tag target type [%s]", assignment.TargetType)
	}
	return nil
}

func (policy *StudyPolicy) validate(entityID string) error {
	if err := validatePayloadID(entityID, policy.ID); err != nil {
		return err
	}
	if strings.TrimSpace(policy.ScopeID) == "" || (policy.ScopeType != "document" && policy.ScopeType != "notebook") {
		return errors.New("study policy scope is invalid")
	}
	if !validStudyPriority(policy.Priority) {
		return fmt.Errorf("unsupported study priority [%s]", policy.Priority)
	}
	if policy.TargetDate != nil && *policy.TargetDate < 0 {
		return errors.New("study policy target date must not be negative")
	}
	if policy.CreatedAt < 0 || policy.UpdatedAt < policy.CreatedAt {
		return errors.New("study policy timestamps are invalid")
	}
	return nil
}

func validStudyPriority(priority string) bool {
	switch priority {
	case "exam", "learning", "retaining", "paused", "unset":
		return true
	default:
		return false
	}
}

func (session *StudySession) validate(entityID string) error {
	if err := validatePayloadID(entityID, session.ID); err != nil {
		return err
	}
	if session.ReviewMode != "normal" && session.ReviewMode != "reinforcement" {
		return fmt.Errorf("unsupported study session review mode [%s]", session.ReviewMode)
	}
	if session.Status != "active" && session.Status != "completed" && session.Status != "abandoned" {
		return fmt.Errorf("unsupported study session status [%s]", session.Status)
	}
	if strings.TrimSpace(session.Seed) == "" || strings.TrimSpace(session.SelectionDigest) == "" ||
		session.StartedAt < 0 {
		return errors.New("study session seed and start time are required")
	}
	if session.NewLimit < 0 || session.ReviewLimit < 0 {
		return errors.New("study session limits must not be negative")
	}
	if len(session.QueryAST) != 0 {
		if _, err := ParseQueryAST(session.QueryAST); err != nil {
			return err
		}
	}
	if session.ReviewMode == "normal" &&
		(session.IncludeSuspended || session.IncludeBuried || session.IncludePaused) {
		return errors.New("normal study session cannot include paused, suspended or buried cards")
	}
	if session.EndedAt != nil && *session.EndedAt < session.StartedAt {
		return errors.New("study session end time precedes its start time")
	}
	if session.Status == "active" && session.EndedAt != nil {
		return errors.New("active study session must not have an end time")
	}
	if session.Status != "active" && session.EndedAt == nil {
		return errors.New("finished study session requires an end time")
	}
	return nil
}

func (sessionCard *SessionCard) validate(entityID string) error {
	if err := validatePayloadID(entityID, sessionCard.ID); err != nil {
		return err
	}
	if strings.TrimSpace(sessionCard.SessionID) == "" || strings.TrimSpace(sessionCard.CardID) == "" ||
		sessionCard.Sort < 0 {
		return errors.New("session card identity and sort are invalid")
	}
	if sessionCard.Status != "queued" && sessionCard.Status != "shown" && sessionCard.Status != "reviewed" &&
		sessionCard.Status != "skipped" {
		return fmt.Errorf("unsupported session card status [%s]", sessionCard.Status)
	}
	if sessionCard.Status == "skipped" && strings.TrimSpace(sessionCard.SkipReason) == "" {
		return errors.New("skipped session card requires a reason")
	}
	if err := validateUniqueStrings("session card option order", sessionCard.OptionOrder, false); err != nil {
		return err
	}
	dynamicIDs := make([]string, 0, len(sessionCard.DynamicOptions))
	dynamicEntities := make([]string, 0, len(sessionCard.DynamicOptions))
	for _, option := range sessionCard.DynamicOptions {
		if strings.TrimSpace(option.ID) == "" || option.EntityType != "block" ||
			strings.TrimSpace(option.EntityID) == "" {
			return errors.New("session dynamic choice option is invalid")
		}
		dynamicIDs = append(dynamicIDs, option.ID)
		dynamicEntities = append(dynamicEntities, option.EntityID)
	}
	if err := validateUniqueStrings("session dynamic choice option IDs", dynamicIDs, false); err != nil {
		return err
	}
	if err := validateUniqueStrings("session dynamic choice option entities", dynamicEntities, false); err != nil {
		return err
	}
	optionOrder := make(map[string]struct{}, len(sessionCard.OptionOrder))
	for _, optionID := range sessionCard.OptionOrder {
		optionOrder[optionID] = struct{}{}
	}
	for _, optionID := range dynamicIDs {
		if _, found := optionOrder[optionID]; !found {
			return errors.New("session dynamic choice option is missing from the frozen order")
		}
	}
	return validateOptionalJSON("session card step results", sessionCard.StepResults)
}

func (alias *LegacyCardAlias) validate(entityID string) error {
	if err := validatePayloadID(entityID, alias.ID); err != nil {
		return err
	}
	if strings.TrimSpace(alias.LegacyDeckID) == "" || strings.TrimSpace(alias.LegacyCardID) == "" ||
		strings.TrimSpace(alias.BlockID) == "" || strings.TrimSpace(alias.CardID) == "" {
		return errors.New("legacy card alias identity is incomplete")
	}
	return alias.State.validate()
}

func validateReviewEvent(event *Event) error {
	var payload ReviewEventPayload
	if err := decodeStrictJSON(event.Payload, &payload); err != nil {
		return fmt.Errorf("decode flashcard review event: %w", err)
	}
	if strings.TrimSpace(payload.CardID) == "" || strings.TrimSpace(payload.SourceID) == "" ||
		strings.TrimSpace(payload.Kind) == "" {
		return errors.New("flashcard review event identity is incomplete")
	}
	if event.EntityID != payload.CardID {
		return errors.New("flashcard review event entity ID does not match card ID")
	}
	if event.OccurredAt != payload.ReviewedAt || payload.ReviewedAt < 0 {
		return errors.New("flashcard review event timestamps do not match")
	}
	if payload.DurationMS != nil && *payload.DurationMS < 0 {
		return errors.New("flashcard review duration must not be negative")
	}
	if err := validateOptionalJSON("flashcard review answer result", payload.AnswerResult); err != nil {
		return err
	}
	if payload.BeforeState != nil {
		if err := payload.BeforeState.validate(); err != nil {
			return fmt.Errorf("validate flashcard state before review: %w", err)
		}
	}
	if payload.AfterState != nil {
		if err := payload.AfterState.validate(); err != nil {
			return fmt.Errorf("validate flashcard state after review: %w", err)
		}
	}
	if payload.ReviewMode != "normal" && payload.ReviewMode != "reinforcement" {
		return fmt.Errorf("unsupported flashcard review mode [%s]", payload.ReviewMode)
	}
	if payload.Kind == "review" {
		switch payload.Rating {
		case ReviewAgain, ReviewHard, ReviewGood, ReviewEasy:
		default:
			return fmt.Errorf("unsupported flashcard review rating [%s]", payload.Rating)
		}
	} else if payload.Rating != "" {
		return errors.New("non-review flashcard event must not contain a rating")
	}
	if payload.Kind != "review" && payload.Kind != "reset" && payload.Kind != "setDue" &&
		payload.Kind != "reschedule" {
		return fmt.Errorf("unsupported flashcard review event kind [%s]", payload.Kind)
	}
	legacyReview := payload.OriginCardID != "" && payload.SchedulerVersion == "legacy-unknown"
	if payload.ReviewMode == "normal" && !legacyReview {
		if payload.BeforeState == nil || payload.AfterState == nil || strings.TrimSpace(payload.SchedulerVersion) == "" ||
			strings.TrimSpace(payload.PresetRevisionID) == "" || strings.TrimSpace(payload.BaseStateRevisionID) == "" {
			return errors.New("normal flashcard review event lacks scheduler state")
		}
		if payload.Kind == "review" && (payload.DurationMS == nil || payload.ReviewedAt == 0) {
			return errors.New("normal flashcard rating requires review time and duration")
		}
		if err := validateRequiredJSON("flashcard scheduler input", payload.SchedulerInput); err != nil {
			return err
		}
	} else if payload.ReviewMode == "reinforcement" {
		if payload.AfterState != nil {
			return errors.New("reinforcement review event must not contain a changed scheduler state")
		}
		if payload.Kind == "review" && (payload.BeforeState == nil || payload.DurationMS == nil || payload.ReviewedAt == 0) {
			return errors.New("reinforcement flashcard rating requires state, review time and duration")
		}
	} else if legacyReview {
		if payload.AfterState != nil || strings.TrimSpace(payload.PresetRevisionID) == "" {
			return errors.New("legacy flashcard review event has invalid scheduler state")
		}
		if err := validateRequiredJSON("legacy flashcard scheduler input", payload.SchedulerInput); err != nil {
			return err
		}
	}
	return nil
}

func validateReviewUndoneEvent(event *Event) error {
	var payload ReviewUndoneEventPayload
	if err := decodeStrictJSON(event.Payload, &payload); err != nil {
		return fmt.Errorf("decode flashcard review undo event: %w", err)
	}
	if strings.TrimSpace(payload.ReviewEventID) == "" || strings.TrimSpace(payload.CardID) == "" {
		return errors.New("flashcard review undo event identity is incomplete")
	}
	if event.EntityID != payload.CardID {
		return errors.New("flashcard review undo event entity ID does not match card ID")
	}
	if event.OccurredAt != payload.UndoneAt || payload.UndoneAt <= 0 {
		return errors.New("flashcard review undo event timestamps do not match")
	}
	return validateUniqueStrings("flashcard reverted revision IDs", payload.RevertedRevisionIDs, false)
}
