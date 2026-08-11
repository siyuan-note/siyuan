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
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
)

var businessProjectionSchema = []string{
	`CREATE TABLE IF NOT EXISTS card_schemas (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		builtin_type TEXT NOT NULL,
		fields BLOB NOT NULL,
		template_ids BLOB NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS card_templates (
		id TEXT PRIMARY KEY,
		schema_id TEXT NOT NULL,
		name TEXT NOT NULL,
		generation_rule BLOB NOT NULL,
		front_spec BLOB NOT NULL,
		back_spec BLOB NOT NULL,
		answer_mode TEXT NOT NULL,
		context_policy BLOB,
		style TEXT NOT NULL,
		enabled INTEGER NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_card_templates_schema ON card_templates(schema_id, enabled, id)`,
	`CREATE TABLE IF NOT EXISTS card_sources (
		id TEXT PRIMARY KEY,
		schema_id TEXT NOT NULL,
		source_type TEXT NOT NULL,
		primary_ref_id TEXT NOT NULL,
		default_preset_id TEXT NOT NULL,
		priority TEXT NOT NULL,
		generation_config BLOB NOT NULL,
		status TEXT NOT NULL,
		plugin_namespace TEXT NOT NULL,
		plugin_data_version INTEGER NOT NULL,
		plugin_data BLOB,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_card_sources_schema ON card_sources(schema_id, status, id)`,
	`CREATE INDEX IF NOT EXISTS idx_card_sources_primary_ref ON card_sources(primary_ref_id, status, id)`,
	`CREATE TABLE IF NOT EXISTS card_source_refs (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL,
		field_id TEXT NOT NULL,
		entity_type TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		role TEXT NOT NULL,
		sort INTEGER NOT NULL,
		required INTEGER NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_card_source_refs_source ON card_source_refs(source_id, field_id, role, sort, id)`,
	`CREATE INDEX IF NOT EXISTS idx_card_source_refs_entity ON card_source_refs(entity_type, entity_id, source_id)`,
	`CREATE TABLE IF NOT EXISTS cards (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL,
		template_id TEXT NOT NULL,
		variant_key TEXT NOT NULL,
		variant_data BLOB,
		generation_status TEXT NOT NULL,
		flag INTEGER NOT NULL,
		preset_override_id TEXT NOT NULL,
		priority_override TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		revision_id TEXT NOT NULL,
		UNIQUE(source_id, template_id, variant_key)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_cards_status_source ON cards(generation_status, source_id, id)`,
	`CREATE INDEX IF NOT EXISTS idx_cards_template ON cards(template_id, generation_status, id)`,
	`CREATE TABLE IF NOT EXISTS review_states (
		card_id TEXT PRIMARY KEY,
		state TEXT NOT NULL,
		due INTEGER NOT NULL,
		last_review INTEGER,
		stability REAL NOT NULL,
		difficulty REAL NOT NULL,
		elapsed_days INTEGER NOT NULL,
		scheduled_days INTEGER NOT NULL,
		reps INTEGER NOT NULL,
		lapses INTEGER NOT NULL,
		suspended INTEGER NOT NULL,
		buried_until INTEGER,
		buried_reason TEXT NOT NULL,
		state_revision_id TEXT NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_review_states_queue ON review_states(suspended, buried_until, due, card_id)`,
	`CREATE INDEX IF NOT EXISTS idx_review_states_last_review ON review_states(last_review, card_id)`,
	`CREATE TABLE IF NOT EXISTS review_events (
		event_id TEXT PRIMARY KEY,
		card_id TEXT NOT NULL,
		source_id TEXT NOT NULL,
		origin_card_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		rating TEXT NOT NULL,
		reviewed_at INTEGER NOT NULL,
		duration_ms INTEGER,
		base_state_revision_id TEXT NOT NULL,
		before_state BLOB,
		after_state BLOB,
		scheduler_version TEXT NOT NULL,
		preset_revision_id TEXT NOT NULL,
		scheduler_input BLOB,
		session_id TEXT NOT NULL,
		review_set_id TEXT NOT NULL,
		review_mode TEXT NOT NULL,
		writer_id TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		batch_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_review_events_card_time ON review_events(card_id, reviewed_at, event_id)`,
	`CREATE INDEX IF NOT EXISTS idx_review_events_time ON review_events(reviewed_at, event_id)`,
	`CREATE INDEX IF NOT EXISTS idx_review_events_session ON review_events(session_id, reviewed_at, event_id)`,
	`CREATE TABLE IF NOT EXISTS tags (
		id TEXT PRIMARY KEY,
		parent_id TEXT NOT NULL,
		name TEXT NOT NULL,
		normalized_name TEXT NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id, normalized_name, id)`,
	`CREATE TABLE IF NOT EXISTS tag_assignments (
		id TEXT PRIMARY KEY,
		tag_id TEXT NOT NULL,
		target_type TEXT NOT NULL,
		target_id TEXT NOT NULL,
		revision_id TEXT NOT NULL,
		UNIQUE(tag_id, target_type, target_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag ON tag_assignments(tag_id, target_type, target_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tag_assignments_target ON tag_assignments(target_type, target_id, tag_id)`,
	`CREATE TABLE IF NOT EXISTS review_sets (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		legacy_deck_id TEXT NOT NULL,
		query_ast BLOB,
		order_spec BLOB,
		new_limit INTEGER NOT NULL,
		review_limit INTEGER NOT NULL,
		default_review_mode TEXT NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS review_set_memberships (
		id TEXT PRIMARY KEY,
		review_set_id TEXT NOT NULL,
		card_id TEXT NOT NULL,
		mode TEXT NOT NULL,
		revision_id TEXT NOT NULL,
		UNIQUE(review_set_id, card_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_review_set_memberships_set ON review_set_memberships(review_set_id, mode, card_id)`,
	`CREATE INDEX IF NOT EXISTS idx_review_set_memberships_card ON review_set_memberships(card_id, review_set_id)`,
	`CREATE TABLE IF NOT EXISTS scheduler_presets (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		scheduler_version TEXT NOT NULL,
		request_retention REAL NOT NULL,
		maximum_interval INTEGER NOT NULL,
		weights BLOB NOT NULL,
		new_limit INTEGER NOT NULL,
		review_limit INTEGER NOT NULL,
		bury_new_siblings INTEGER NOT NULL,
		bury_review_siblings INTEGER NOT NULL,
		leech_threshold INTEGER NOT NULL,
		leech_action TEXT NOT NULL,
		revision_id TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS study_policies (
		id TEXT PRIMARY KEY,
		scope_type TEXT NOT NULL,
		scope_id TEXT NOT NULL,
		priority TEXT NOT NULL,
		target_date INTEGER,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		revision_id TEXT NOT NULL,
		UNIQUE(scope_type, scope_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_study_policies_scope ON study_policies(scope_type, scope_id)`,
	`CREATE TABLE IF NOT EXISTS block_metadata (
		block_id TEXT PRIMARY KEY,
		notebook_id TEXT NOT NULL,
		root_id TEXT NOT NULL,
		path TEXT NOT NULL,
		h_path TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_block_metadata_location ON block_metadata(notebook_id, path, block_id)`,
	`CREATE TABLE IF NOT EXISTS source_availability (
		source_id TEXT PRIMARY KEY,
		available INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS study_sessions (
		id TEXT PRIMARY KEY,
		review_set_id TEXT NOT NULL,
		query_ast BLOB,
		review_mode TEXT NOT NULL,
		status TEXT NOT NULL,
		seed TEXT NOT NULL,
		new_limit INTEGER NOT NULL,
		review_limit INTEGER NOT NULL,
		include_suspended INTEGER NOT NULL,
		include_buried INTEGER NOT NULL,
		include_paused INTEGER NOT NULL,
		selection_digest TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		revision_id TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_study_sessions_status ON study_sessions(status, started_at, id)`,
	`CREATE TABLE IF NOT EXISTS session_cards (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		card_id TEXT NOT NULL,
		sort INTEGER NOT NULL,
		status TEXT NOT NULL,
		skip_reason TEXT NOT NULL,
		option_order BLOB,
		step_results BLOB,
		revision_id TEXT NOT NULL,
		UNIQUE(session_id, card_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_session_cards_order ON session_cards(session_id, sort, id)`,
	`CREATE TABLE IF NOT EXISTS legacy_card_aliases (
		id TEXT PRIMARY KEY,
		legacy_deck_id TEXT NOT NULL,
		legacy_card_id TEXT NOT NULL,
		block_id TEXT NOT NULL,
		card_id TEXT NOT NULL,
		selected INTEGER NOT NULL,
		state BLOB NOT NULL,
		revision_id TEXT NOT NULL,
		UNIQUE(legacy_deck_id, legacy_card_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_legacy_card_aliases_card ON legacy_card_aliases(card_id, selected, id)`,
}

type projectionObject struct {
	typ  string
	name string
}

var requiredProjectionObjects = []projectionObject{
	{typ: "table", name: "applied_changes"},
	{typ: "table", name: "operation_batches"},
	{typ: "table", name: "entity_revisions"},
	{typ: "table", name: "revision_parents"},
	{typ: "table", name: "entities"},
	{typ: "table", name: "entity_conflicts"},
	{typ: "table", name: "events"},
	{typ: "table", name: "writer_sequences"},
	{typ: "table", name: "writer_high_watermarks"},
	{typ: "table", name: "projection_meta"},
	{typ: "table", name: "card_schemas"},
	{typ: "table", name: "card_templates"},
	{typ: "table", name: "card_sources"},
	{typ: "table", name: "card_source_refs"},
	{typ: "table", name: "cards"},
	{typ: "table", name: "review_states"},
	{typ: "table", name: "review_events"},
	{typ: "table", name: "tags"},
	{typ: "table", name: "tag_assignments"},
	{typ: "table", name: "review_sets"},
	{typ: "table", name: "review_set_memberships"},
	{typ: "table", name: "scheduler_presets"},
	{typ: "table", name: "study_policies"},
	{typ: "table", name: "block_metadata"},
	{typ: "table", name: "source_availability"},
	{typ: "table", name: "study_sessions"},
	{typ: "table", name: "session_cards"},
	{typ: "table", name: "legacy_card_aliases"},
	{typ: "index", name: "idx_cards_status_source"},
	{typ: "index", name: "idx_review_states_queue"},
	{typ: "index", name: "idx_card_source_refs_entity"},
	{typ: "index", name: "idx_tag_assignments_tag"},
	{typ: "index", name: "idx_review_events_card_time"},
	{typ: "index", name: "idx_review_events_time"},
	{typ: "index", name: "idx_review_events_session"},
	{typ: "index", name: "idx_review_set_memberships_set"},
	{typ: "index", name: "idx_block_metadata_location"},
}

func allProjectionSchema() []string {
	ret := make([]string, 0, len(projectionSchema)+len(businessProjectionSchema))
	ret = append(ret, projectionSchema...)
	ret = append(ret, businessProjectionSchema...)
	return ret
}

func projectionSchemaDigest() (string, error) {
	return checksum(allProjectionSchema())
}

func projectCurrentEntity(ctx context.Context, tx *sql.Tx, revision *EntityRevision) error {
	if revision.Deleted {
		return deleteProjectedEntity(ctx, tx, revision.EntityType, revision.EntityID)
	}
	switch revision.EntityType {
	case EntityCardSchema:
		var value CardSchema
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		fields, err := CanonicalJSON(value.Fields)
		if err != nil {
			return err
		}
		templateIDs, err := CanonicalJSON(value.TemplateIDs)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO card_schemas
			(id, name, builtin_type, fields, template_ids, created_at, updated_at, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET name = excluded.name, builtin_type = excluded.builtin_type,
			fields = excluded.fields, template_ids = excluded.template_ids, created_at = excluded.created_at,
			updated_at = excluded.updated_at, revision_id = excluded.revision_id`, value.ID, value.Name,
			value.BuiltinType, fields, templateIDs, value.CreatedAt, value.UpdatedAt, revision.RevisionID)
		return wrapProjectionError("card schema", err)
	case EntityCardTemplate:
		var value CardTemplate
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO card_templates
			(id, schema_id, name, generation_rule, front_spec, back_spec, answer_mode, context_policy, style, enabled,
			revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET schema_id = excluded.schema_id, name = excluded.name,
			generation_rule = excluded.generation_rule, front_spec = excluded.front_spec, back_spec = excluded.back_spec,
			answer_mode = excluded.answer_mode, context_policy = excluded.context_policy, style = excluded.style,
			enabled = excluded.enabled, revision_id = excluded.revision_id`, value.ID, value.SchemaID, value.Name,
			[]byte(value.GenerationRule), []byte(value.FrontSpec), []byte(value.BackSpec), value.AnswerMode,
			nullableJSON(value.ContextPolicy), value.Style, value.Enabled, revision.RevisionID)
		return wrapProjectionError("card template", err)
	case EntityCardSource:
		var value CardSource
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO card_sources
			(id, schema_id, source_type, primary_ref_id, default_preset_id, priority, generation_config, status,
			plugin_namespace, plugin_data_version, plugin_data, revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET schema_id = excluded.schema_id, source_type = excluded.source_type,
			primary_ref_id = excluded.primary_ref_id, default_preset_id = excluded.default_preset_id,
			priority = excluded.priority, generation_config = excluded.generation_config, status = excluded.status,
			plugin_namespace = excluded.plugin_namespace, plugin_data_version = excluded.plugin_data_version,
			plugin_data = excluded.plugin_data, revision_id = excluded.revision_id`, value.ID, value.SchemaID,
			value.SourceType, value.PrimaryRefID, value.DefaultPresetID, value.Priority, []byte(value.GenerationConfig),
			value.Status, value.PluginNamespace, value.PluginDataVersion, nullableJSON(value.PluginData),
			revision.RevisionID)
		return wrapProjectionError("card source", err)
	case EntityCardSourceRef:
		var value CardSourceRef
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO card_source_refs
			(id, source_id, field_id, entity_type, entity_id, role, sort, required, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, field_id = excluded.field_id,
			entity_type = excluded.entity_type, entity_id = excluded.entity_id, role = excluded.role,
			sort = excluded.sort, required = excluded.required, revision_id = excluded.revision_id`, value.ID,
			value.SourceID, value.FieldID, value.EntityType, value.EntityID, value.Role, value.Sort, value.Required,
			revision.RevisionID)
		return wrapProjectionError("card source reference", err)
	case EntityCard:
		var value Card
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO cards
			(id, source_id, template_id, variant_key, variant_data, generation_status, flag, preset_override_id,
			priority_override, created_at, updated_at, revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, template_id = excluded.template_id,
			variant_key = excluded.variant_key, variant_data = excluded.variant_data,
			generation_status = excluded.generation_status, flag = excluded.flag,
			preset_override_id = excluded.preset_override_id, priority_override = excluded.priority_override,
			created_at = excluded.created_at, updated_at = excluded.updated_at, revision_id = excluded.revision_id`,
			value.ID, value.SourceID, value.TemplateID, value.VariantKey, nullableJSON(value.VariantData),
			value.GenerationStatus, value.Flag, value.PresetOverrideID, value.PriorityOverride, value.CreatedAt,
			value.UpdatedAt, revision.RevisionID)
		return wrapProjectionError("card", err)
	case EntityReviewState:
		var value ReviewState
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO review_states
			(card_id, state, due, last_review, stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
			suspended, buried_until, buried_reason, state_revision_id, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(card_id) DO UPDATE SET state = excluded.state, due = excluded.due,
			last_review = excluded.last_review, stability = excluded.stability, difficulty = excluded.difficulty,
			elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days, reps = excluded.reps,
			lapses = excluded.lapses, suspended = excluded.suspended, buried_until = excluded.buried_until,
			buried_reason = excluded.buried_reason, state_revision_id = excluded.state_revision_id,
			revision_id = excluded.revision_id`, value.CardID, value.State, value.Due,
			nullablePositiveInt64(value.LastReview), value.Stability, value.Difficulty, value.ElapsedDays,
			value.ScheduledDays, value.Reps, value.Lapses, value.Suspended, nullablePositiveInt64(value.BuriedUntil),
			value.BuriedReason, value.StateRevisionID, revision.RevisionID)
		return wrapProjectionError("review state", err)
	case EntityReviewSet:
		var value ReviewSet
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO review_sets
			(id, name, legacy_deck_id, query_ast, order_spec, new_limit, review_limit, default_review_mode, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET name = excluded.name, legacy_deck_id = excluded.legacy_deck_id,
			query_ast = excluded.query_ast,
			order_spec = excluded.order_spec, new_limit = excluded.new_limit, review_limit = excluded.review_limit,
			default_review_mode = excluded.default_review_mode, revision_id = excluded.revision_id`, value.ID,
			value.Name, value.LegacyDeckID, nullableJSON(value.QueryAST), nullableJSON(value.Order), value.NewLimit,
			value.ReviewLimit, value.DefaultReviewMode, revision.RevisionID)
		return wrapProjectionError("review set", err)
	case EntityReviewSetMembership:
		var value ReviewSetMembership
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO review_set_memberships
			(id, review_set_id, card_id, mode, revision_id) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET review_set_id = excluded.review_set_id, card_id = excluded.card_id,
			mode = excluded.mode, revision_id = excluded.revision_id`, value.ID, value.ReviewSetID, value.CardID,
			value.Mode, revision.RevisionID)
		return wrapProjectionError("review set membership", err)
	case EntitySchedulerPreset:
		var value SchedulerPreset
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		weights, err := CanonicalJSON(value.Weights)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO scheduler_presets
			(id, name, scheduler_version, request_retention, maximum_interval, weights, new_limit, review_limit,
			bury_new_siblings, bury_review_siblings, leech_threshold, leech_action, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET name = excluded.name, scheduler_version = excluded.scheduler_version,
			request_retention = excluded.request_retention,
			maximum_interval = excluded.maximum_interval, weights = excluded.weights, new_limit = excluded.new_limit,
			review_limit = excluded.review_limit, bury_new_siblings = excluded.bury_new_siblings,
			bury_review_siblings = excluded.bury_review_siblings, leech_threshold = excluded.leech_threshold,
			leech_action = excluded.leech_action, revision_id = excluded.revision_id`, value.ID, value.Name,
			value.SchedulerVersion, value.RequestRetention, value.MaximumInterval, weights, value.NewLimit, value.ReviewLimit,
			value.BuryNewSiblings, value.BuryReviewSiblings, value.LeechThreshold, value.LeechAction,
			revision.RevisionID)
		return wrapProjectionError("scheduler preset", err)
	case EntityTag:
		var value Tag
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO tags(id, parent_id, name, normalized_name, revision_id)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id,
			name = excluded.name, normalized_name = excluded.normalized_name, revision_id = excluded.revision_id`,
			value.ID, value.ParentID, value.Name, value.NormalizedName, revision.RevisionID)
		return wrapProjectionError("tag", err)
	case EntityTagAssignment:
		var value TagAssignment
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO tag_assignments(id, tag_id, target_type, target_id, revision_id)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tag_id = excluded.tag_id,
			target_type = excluded.target_type, target_id = excluded.target_id, revision_id = excluded.revision_id`,
			value.ID, value.TagID, value.TargetType, value.TargetID, revision.RevisionID)
		return wrapProjectionError("tag assignment", err)
	case EntityStudyPolicy:
		var value StudyPolicy
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO study_policies
			(id, scope_type, scope_id, priority, target_date, created_at, updated_at, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET scope_type = excluded.scope_type,
			scope_id = excluded.scope_id, priority = excluded.priority, target_date = excluded.target_date,
			created_at = excluded.created_at, updated_at = excluded.updated_at, revision_id = excluded.revision_id`,
			value.ID, value.ScopeType, value.ScopeID, value.Priority, value.TargetDate, value.CreatedAt, value.UpdatedAt,
			revision.RevisionID)
		return wrapProjectionError("study policy", err)
	case EntityStudySession:
		var value StudySession
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO study_sessions
			(id, review_set_id, query_ast, review_mode, status, seed, new_limit, review_limit, include_suspended,
			include_buried, include_paused, selection_digest, started_at, ended_at, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET review_set_id = excluded.review_set_id, query_ast = excluded.query_ast,
			review_mode = excluded.review_mode, status = excluded.status, seed = excluded.seed,
			new_limit = excluded.new_limit, review_limit = excluded.review_limit,
			include_suspended = excluded.include_suspended, include_buried = excluded.include_buried,
			include_paused = excluded.include_paused,
			selection_digest = excluded.selection_digest, started_at = excluded.started_at,
			ended_at = excluded.ended_at, revision_id = excluded.revision_id`, value.ID, value.ReviewSetID,
			nullableJSON(value.QueryAST), value.ReviewMode, value.Status, value.Seed, value.NewLimit, value.ReviewLimit,
			value.IncludeSuspended, value.IncludeBuried, value.IncludePaused, value.SelectionDigest, value.StartedAt,
			value.EndedAt, revision.RevisionID)
		return wrapProjectionError("study session", err)
	case EntitySessionCard:
		var value SessionCard
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		optionOrder, err := optionalCanonicalJSON(value.OptionOrder)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO session_cards
			(id, session_id, card_id, sort, status, skip_reason, option_order, step_results, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id,
			card_id = excluded.card_id, sort = excluded.sort, status = excluded.status,
			skip_reason = excluded.skip_reason, option_order = excluded.option_order,
			step_results = excluded.step_results, revision_id = excluded.revision_id`, value.ID, value.SessionID,
			value.CardID, value.Sort, value.Status, value.SkipReason, optionOrder, nullableJSON(value.StepResults),
			revision.RevisionID)
		return wrapProjectionError("session card", err)
	case EntityLegacyCardAlias:
		var value LegacyCardAlias
		if err := decodeStrictJSON(revision.Payload, &value); err != nil {
			return err
		}
		state, err := CanonicalJSON(value.State)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO legacy_card_aliases
			(id, legacy_deck_id, legacy_card_id, block_id, card_id, selected, state, revision_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET legacy_deck_id = excluded.legacy_deck_id,
			legacy_card_id = excluded.legacy_card_id, block_id = excluded.block_id, card_id = excluded.card_id,
			selected = excluded.selected, state = excluded.state, revision_id = excluded.revision_id`, value.ID,
			value.LegacyDeckID, value.LegacyCardID, value.BlockID, value.CardID, value.Selected, state,
			revision.RevisionID)
		return wrapProjectionError("legacy card alias", err)
	default:
		return fmt.Errorf("unsupported projected flashcard entity type [%s]", revision.EntityType)
	}
}

func deleteProjectedEntity(ctx context.Context, tx *sql.Tx, entityType EntityType, entityID string) error {
	table := ""
	column := "id"
	switch entityType {
	case EntityCardSchema:
		table = "card_schemas"
	case EntityCardTemplate:
		table = "card_templates"
	case EntityCardSource:
		table = "card_sources"
	case EntityCardSourceRef:
		table = "card_source_refs"
	case EntityCard:
		table = "cards"
	case EntityReviewState:
		table = "review_states"
		column = "card_id"
	case EntityReviewSet:
		table = "review_sets"
	case EntityReviewSetMembership:
		table = "review_set_memberships"
	case EntitySchedulerPreset:
		table = "scheduler_presets"
	case EntityTag:
		table = "tags"
	case EntityTagAssignment:
		table = "tag_assignments"
	case EntityStudyPolicy:
		table = "study_policies"
	case EntityStudySession:
		table = "study_sessions"
	case EntitySessionCard:
		table = "session_cards"
	case EntityLegacyCardAlias:
		table = "legacy_card_aliases"
	default:
		return fmt.Errorf("unsupported projected flashcard entity type [%s]", entityType)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE "+column+" = ?", entityID); err != nil {
		return fmt.Errorf("delete projected flashcard entity [%s]: %w", entityType, err)
	}
	return nil
}

func projectReviewEvent(ctx context.Context, tx *sql.Tx, batch OperationBatch, event *Event) error {
	if event.EventType != EventReview {
		return nil
	}
	var value ReviewEventPayload
	if err := decodeStrictJSON(event.Payload, &value); err != nil {
		return err
	}
	beforeState, err := optionalCanonicalJSON(value.BeforeState)
	if err != nil {
		return err
	}
	afterState, err := optionalCanonicalJSON(value.AfterState)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO review_events
		(event_id, card_id, source_id, origin_card_id, kind, rating, reviewed_at, duration_ms,
		base_state_revision_id, before_state, after_state, scheduler_version, preset_revision_id, scheduler_input,
		session_id, review_set_id, review_mode, writer_id, sequence, batch_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_id) DO UPDATE SET card_id = excluded.card_id, source_id = excluded.source_id,
		origin_card_id = excluded.origin_card_id, kind = excluded.kind, rating = excluded.rating,
		reviewed_at = excluded.reviewed_at, duration_ms = excluded.duration_ms,
		base_state_revision_id = excluded.base_state_revision_id, before_state = excluded.before_state,
		after_state = excluded.after_state, scheduler_version = excluded.scheduler_version,
		preset_revision_id = excluded.preset_revision_id, scheduler_input = excluded.scheduler_input,
		session_id = excluded.session_id, review_set_id = excluded.review_set_id,
		review_mode = excluded.review_mode, writer_id = excluded.writer_id, sequence = excluded.sequence,
		batch_id = excluded.batch_id`, event.EventID, value.CardID, value.SourceID, value.OriginCardID, value.Kind,
		value.Rating, value.ReviewedAt, value.DurationMS, value.BaseStateRevisionID, beforeState, afterState,
		value.SchedulerVersion, value.PresetRevisionID, nullableJSON(value.SchedulerInput), value.SessionID,
		value.ReviewSetID, value.ReviewMode, batch.WriterID, batch.Sequence, batch.BatchID)
	return wrapProjectionError("review event", err)
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return []byte(value)
}

func nullablePositiveInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func optionalCanonicalJSON(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	reflected := reflect.ValueOf(value)
	if (reflected.Kind() == reflect.Pointer || reflected.Kind() == reflect.Slice ||
		reflected.Kind() == reflect.Map || reflected.Kind() == reflect.Interface) && reflected.IsNil() {
		return nil, nil
	}
	data, err := CanonicalJSON(value)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func wrapProjectionError(entity string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("project flashcard %s: %w", entity, err)
}
