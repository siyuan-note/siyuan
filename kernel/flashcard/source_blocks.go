// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"encoding/json"
)

func (projection *Projection) ActiveSourceBlockIDs(ctx context.Context, blockIDs []string) ([]string, error) {
	ret := make([]string, 0)
	if len(blockIDs) == 0 {
		return ret, nil
	}
	ids, err := json.Marshal(blockIDs)
	if err != nil {
		return nil, err
	}
	rows, err := projection.db.QueryContext(ctx, `
		SELECT DISTINCT ref.entity_id FROM card_source_refs ref
		JOIN card_sources source ON source.id = ref.source_id AND source.primary_ref_id = ref.id
		WHERE ref.entity_type = 'block' AND ref.entity_id IN (SELECT value FROM json_each(?))
		AND source.status = 'active' AND EXISTS (
			SELECT 1 FROM cards card WHERE card.source_id = source.id AND card.generation_status = ?
		) ORDER BY ref.entity_id`, string(ids), GenerationActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ret = append(ret, id)
	}
	return ret, rows.Err()
}
