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
	"errors"
	"fmt"
)

// CardHasUnresolvedConflict 检查会影响评分、队列或管理语义的全部当前依赖冲突。
func (projection *Projection) CardHasUnresolvedConflict(ctx context.Context, cardID string) (bool, error) {
	var found int
	err := projection.db.QueryRowContext(ctx, `SELECT 1 FROM cards c JOIN card_sources s ON s.id = c.source_id
		JOIN entity_conflicts ec ON ec.resolved = 0 AND (
			(ec.entity_type IN (?, ?) AND ec.entity_id = c.id) OR
			(ec.entity_type = ? AND ec.entity_id = c.source_id) OR
			(ec.entity_type = ? AND ec.entity_id = c.template_id) OR
			(ec.entity_type = ? AND ec.entity_id = s.schema_id) OR
			(ec.entity_type = ? AND ec.entity_id IN (
				SELECT ref.id FROM card_source_refs ref WHERE ref.source_id = c.source_id
			)) OR
			(ec.entity_type = ? AND ec.entity_id =
				COALESCE(NULLIF(c.preset_override_id, ''), s.default_preset_id)) OR
			(ec.entity_type = ? AND ec.entity_id IN (
				SELECT policy.id FROM study_policies policy
				JOIN card_source_refs primary_ref ON primary_ref.id = s.primary_ref_id
				LEFT JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
				WHERE (policy.scope_type = 'document' AND (policy.scope_id = metadata.root_id OR
					metadata.path LIKE '%/' || policy.scope_id || '/%')) OR
					(policy.scope_type = 'notebook' AND policy.scope_id = metadata.notebook_id)
			)) OR
			(ec.entity_type = ? AND ec.entity_id IN (
				SELECT assignment.id FROM tag_assignments assignment
				WHERE (assignment.target_type = 'card' AND assignment.target_id = c.id) OR
					(assignment.target_type = 'source' AND assignment.target_id = c.source_id)
			)) OR
			(ec.entity_type = ? AND ec.entity_id IN (
				WITH RECURSIVE assigned_tags(id) AS (
					SELECT assignment.tag_id FROM tag_assignments assignment
					WHERE (assignment.target_type = 'card' AND assignment.target_id = c.id) OR
						(assignment.target_type = 'source' AND assignment.target_id = c.source_id)
					UNION
					SELECT tag.parent_id FROM tags tag JOIN assigned_tags child ON tag.id = child.id
					WHERE tag.parent_id <> ''
				) SELECT id FROM assigned_tags
			))
		) WHERE c.id = ? LIMIT 1`, EntityCard, EntityReviewState, EntityCardSource, EntityCardTemplate,
		EntityCardSchema, EntityCardSourceRef, EntitySchedulerPreset, EntityStudyPolicy, EntityTagAssignment,
		EntityTag, cardID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("query flashcard business conflict: %w", err)
	}
	return true, nil
}

func (projection *Projection) unresolvedConflictEntityIDs(ctx context.Context,
	entityType EntityType) ([]string, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT DISTINCT entity_id FROM entity_conflicts
		WHERE entity_type = ? AND resolved = 0 ORDER BY entity_id`, entityType)
	if err != nil {
		return nil, fmt.Errorf("query unresolved flashcard conflicts: %w", err)
	}
	defer rows.Close()
	var ret []string
	for rows.Next() {
		var entityID string
		if err = rows.Scan(&entityID); err != nil {
			return nil, fmt.Errorf("scan unresolved flashcard conflict entity: %w", err)
		}
		ret = append(ret, entityID)
	}
	return ret, rows.Err()
}

func (projection *Projection) conflictRevisionIDs(ctx context.Context, entityType EntityType,
	entityID string) ([]string, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT revision_id FROM entity_conflicts
		WHERE entity_type = ? AND entity_id = ? AND resolved = 0 ORDER BY revision_id`, entityType, entityID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard conflict revisions: %w", err)
	}
	defer rows.Close()
	var ret []string
	for rows.Next() {
		var revisionID string
		if err = rows.Scan(&revisionID); err != nil {
			return nil, fmt.Errorf("scan flashcard conflict revision: %w", err)
		}
		ret = append(ret, revisionID)
	}
	return ret, rows.Err()
}

func (projection *Projection) entityRevisionByID(ctx context.Context, revisionID string) (EntityRevision, bool, error) {
	var revision EntityRevision
	var parentsJSON, payload []byte
	err := projection.db.QueryRowContext(ctx, `SELECT entity_type, entity_id, parent_revision_ids, updated_at, deleted,
		payload FROM entity_revisions WHERE revision_id = ?`, revisionID).Scan(&revision.EntityType, &revision.EntityID,
		&parentsJSON, &revision.UpdatedAt, &revision.Deleted, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return EntityRevision{}, false, nil
	}
	if err != nil {
		return EntityRevision{}, false, fmt.Errorf("query flashcard entity revision: %w", err)
	}
	if err = json.Unmarshal(parentsJSON, &revision.ParentRevisionIDs); err != nil {
		return EntityRevision{}, false, fmt.Errorf("decode flashcard revision parents: %w", err)
	}
	revision.RevisionID = revisionID
	revision.Payload = json.RawMessage(payload)
	return revision, true, nil
}

func (projection *Projection) isAncestor(ctx context.Context, ancestorID, descendantID string) (bool, error) {
	if ancestorID == descendantID {
		return true, nil
	}
	var found int
	err := projection.db.QueryRowContext(ctx, `WITH RECURSIVE ancestors(revision_id) AS (
		SELECT parent_revision_id FROM revision_parents WHERE revision_id = ?
		UNION
		SELECT p.parent_revision_id FROM revision_parents p JOIN ancestors a ON p.revision_id = a.revision_id
	) SELECT EXISTS(SELECT 1 FROM ancestors WHERE revision_id = ?)`, descendantID, ancestorID).Scan(&found)
	if err != nil {
		return false, fmt.Errorf("query flashcard revision ancestry: %w", err)
	}
	return found != 0, nil
}

func (projection *Projection) reviewEventsForCard(ctx context.Context, cardID string) ([]Event, error) {
	undone, err := projection.undoneReviewEventIDs(ctx, cardID)
	if err != nil {
		return nil, err
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT e.event_id, e.occurred_at, e.payload
		FROM review_events r JOIN events e ON e.event_id = r.event_id
		WHERE r.card_id = ? ORDER BY e.occurred_at, e.event_id`, cardID)
	if err != nil {
		return nil, fmt.Errorf("query review events for conflicted flashcard: %w", err)
	}
	defer rows.Close()
	var ret []Event
	for rows.Next() {
		var event Event
		var payload []byte
		if err = rows.Scan(&event.EventID, &event.OccurredAt, &payload); err != nil {
			return nil, fmt.Errorf("scan review event for conflicted flashcard: %w", err)
		}
		if _, found := undone[event.EventID]; found {
			continue
		}
		event.EventType = EventReview
		event.EntityID = cardID
		event.Payload = json.RawMessage(payload)
		ret = append(ret, event)
	}
	return ret, rows.Err()
}
