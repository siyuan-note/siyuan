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
