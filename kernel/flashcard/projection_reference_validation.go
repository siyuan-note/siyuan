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
	"errors"
	"fmt"
)

type referenceCheck struct {
	name  string
	query string
}

var businessReferenceChecks = []referenceCheck{
	{name: "card template schema", query: `SELECT t.id FROM card_templates t
		LEFT JOIN card_schemas s ON s.id = t.schema_id WHERE s.id IS NULL LIMIT 1`},
	{name: "card source schema or primary reference", query: `SELECT s.id FROM card_sources s
		LEFT JOIN card_schemas cs ON cs.id = s.schema_id
		LEFT JOIN card_source_refs r ON r.id = s.primary_ref_id AND r.source_id = s.id
		WHERE cs.id IS NULL OR r.id IS NULL LIMIT 1`},
	{name: "card source reference", query: `SELECT r.id FROM card_source_refs r
		LEFT JOIN card_sources s ON s.id = r.source_id WHERE s.id IS NULL LIMIT 1`},
	{name: "generated card source or template", query: `SELECT c.id FROM cards c
		LEFT JOIN card_sources s ON s.id = c.source_id
		LEFT JOIN card_templates t ON t.id = c.template_id AND t.schema_id = s.schema_id
		WHERE s.id IS NULL OR t.id IS NULL LIMIT 1`},
	{name: "card scheduler preset", query: `SELECT c.id FROM cards c
		LEFT JOIN scheduler_presets p ON p.id = c.preset_override_id
		WHERE c.preset_override_id <> '' AND p.id IS NULL LIMIT 1`},
	{name: "card source scheduler preset", query: `SELECT s.id FROM card_sources s
		LEFT JOIN scheduler_presets p ON p.id = s.default_preset_id
		WHERE s.default_preset_id <> '' AND p.id IS NULL LIMIT 1`},
	{name: "card review state", query: `SELECT rs.card_id FROM review_states rs
		LEFT JOIN cards c ON c.id = rs.card_id WHERE c.id IS NULL LIMIT 1`},
	{name: "review set membership", query: `SELECT m.id FROM review_set_memberships m
		LEFT JOIN review_sets s ON s.id = m.review_set_id LEFT JOIN cards c ON c.id = m.card_id
		WHERE s.id IS NULL OR c.id IS NULL LIMIT 1`},
	{name: "flashcard tag parent", query: `SELECT t.id FROM tags t
		LEFT JOIN tags p ON p.id = t.parent_id WHERE t.parent_id <> '' AND p.id IS NULL LIMIT 1`},
	{name: "flashcard tag assignment", query: `SELECT a.id FROM tag_assignments a
		LEFT JOIN tags t ON t.id = a.tag_id
		LEFT JOIN cards c ON a.target_type = 'card' AND c.id = a.target_id
		LEFT JOIN card_sources s ON a.target_type = 'source' AND s.id = a.target_id
		WHERE t.id IS NULL OR (a.target_type = 'card' AND c.id IS NULL) OR
		(a.target_type = 'source' AND s.id IS NULL) LIMIT 1`},
	{name: "study session review set", query: `SELECT ss.id FROM study_sessions ss
		LEFT JOIN review_sets rs ON rs.id = ss.review_set_id
		WHERE ss.status = 'active' AND ss.review_set_id <> '' AND rs.id IS NULL LIMIT 1`},
	{name: "study session card", query: `SELECT sc.id FROM session_cards sc
		LEFT JOIN study_sessions ss ON ss.id = sc.session_id LEFT JOIN cards c ON c.id = sc.card_id
		WHERE ss.id IS NULL OR c.id IS NULL LIMIT 1`},
	{name: "legacy card alias", query: `SELECT a.id FROM legacy_card_aliases a
		LEFT JOIN cards c ON c.id = a.card_id WHERE c.id IS NULL LIMIT 1`},
}

func validateBusinessReferences(ctx context.Context, tx *sql.Tx) error {
	for _, check := range businessReferenceChecks {
		var entityID string
		err := tx.QueryRowContext(ctx, check.query).Scan(&entityID)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("validate %s: %w", check.name, err)
		}
		return fmt.Errorf("flashcard %s reference is invalid for entity [%s]", check.name, entityID)
	}
	var duplicateTagID string
	err := tx.QueryRowContext(ctx, `SELECT MIN(id) FROM tags
		GROUP BY parent_id, normalized_name HAVING COUNT(*) > 1 LIMIT 1`).Scan(&duplicateTagID)
	if err == nil {
		return fmt.Errorf("flashcard tag sibling name is duplicated at [%s]", duplicateTagID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("validate flashcard tag sibling names: %w", err)
	}
	var cycleID string
	err = tx.QueryRowContext(ctx, `WITH RECURSIVE ancestry(start_id, id, parent_id) AS (
		SELECT id, id, parent_id FROM tags
		UNION
		SELECT a.start_id, t.id, t.parent_id FROM ancestry a JOIN tags t ON t.id = a.parent_id
		WHERE a.parent_id <> ''
	) SELECT start_id FROM ancestry WHERE parent_id = start_id LIMIT 1`).Scan(&cycleID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("validate flashcard tag hierarchy: %w", err)
	}
	return fmt.Errorf("flashcard tag hierarchy contains a cycle at [%s]", cycleID)
}
