// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func (projection *Projection) templateRevisionsBySchema(ctx context.Context,
	schemaID string) ([]EntityRevision, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id, e.updated_at, e.payload
		FROM card_templates t JOIN entities e ON e.entity_type = ? AND e.entity_id = t.id
		WHERE t.schema_id = ? AND e.deleted = 0 ORDER BY t.id`, EntityCardTemplate, schemaID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard templates by schema: %w", err)
	}
	return scanCurrentRevisions(rows, EntityCardTemplate)
}

func (projection *Projection) cardRevisionsBySource(ctx context.Context,
	sourceID string) ([]EntityRevision, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT e.entity_id, e.revision_id, e.updated_at, e.payload
		FROM cards c JOIN entities e ON e.entity_type = ? AND e.entity_id = c.id
		WHERE c.source_id = ? AND e.deleted = 0 ORDER BY c.template_id, c.variant_key, c.id`, EntityCard, sourceID)
	if err != nil {
		return nil, fmt.Errorf("query flashcards by source: %w", err)
	}
	return scanCurrentRevisions(rows, EntityCard)
}

func scanCurrentRevisions(rows *sql.Rows, entityType EntityType) ([]EntityRevision, error) {
	defer rows.Close()
	var ret []EntityRevision
	for rows.Next() {
		var revision EntityRevision
		var payload []byte
		if err := rows.Scan(&revision.EntityID, &revision.RevisionID, &revision.UpdatedAt, &payload); err != nil {
			return nil, fmt.Errorf("scan current flashcard entity: %w", err)
		}
		revision.EntityType = entityType
		revision.Payload = json.RawMessage(payload)
		ret = append(ret, revision)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate current flashcard entities: %w", err)
	}
	return ret, nil
}
