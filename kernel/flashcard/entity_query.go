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
)

const maxEntityPageSize = 1000

// EntityListOptions 控制管理界面的实体分页。
type EntityListOptions struct {
	IncludeDeleted bool `json:"includeDeleted"`
	Limit          int  `json:"limit"`
	Offset         int  `json:"offset"`
}

// EntityPage 返回当前实体修订和未分页总数。
type EntityPage struct {
	Entities []EntityRevision `json:"entities"`
	Total    int              `json:"total"`
}

// IsSupportedEntityType 报告实体类型是否属于当前格式版本。
func IsSupportedEntityType(entityType EntityType) bool {
	_, found := supportedEntityTypes[entityType]
	return found
}

// ListEntities 按更新时间稳定分页返回一种实体的当前修订。
func (projection *Projection) ListEntities(ctx context.Context, entityType EntityType,
	options EntityListOptions) (EntityPage, error) {
	if !IsSupportedEntityType(entityType) || options.Limit < 0 || options.Limit > maxEntityPageSize ||
		options.Offset < 0 {
		return EntityPage{}, errors.New("flashcard entity list query is invalid")
	}
	limit := options.Limit
	if limit == 0 {
		limit = 100
	}
	deletedClause := " AND deleted = 0"
	if options.IncludeDeleted {
		deletedClause = ""
	}
	var total int
	if err := projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM entities WHERE entity_type = ?`+
		deletedClause, entityType).Scan(&total); err != nil {
		return EntityPage{}, fmt.Errorf("count flashcard entities: %w", err)
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT entity_id, revision_id, updated_at, deleted, payload
		FROM entities WHERE entity_type = ?`+deletedClause+` ORDER BY updated_at DESC, entity_id LIMIT ? OFFSET ?`,
		entityType, limit, options.Offset)
	if err != nil {
		return EntityPage{}, fmt.Errorf("list flashcard entities: %w", err)
	}
	defer rows.Close()
	ret := EntityPage{Entities: make([]EntityRevision, 0), Total: total}
	for rows.Next() {
		var revision EntityRevision
		var payload []byte
		if err = rows.Scan(&revision.EntityID, &revision.RevisionID, &revision.UpdatedAt, &revision.Deleted,
			&payload); err != nil {
			return EntityPage{}, fmt.Errorf("scan flashcard entity list: %w", err)
		}
		revision.EntityType = entityType
		revision.Payload = json.RawMessage(payload)
		ret.Entities = append(ret.Entities, revision)
	}
	if err = rows.Err(); err != nil {
		return EntityPage{}, fmt.Errorf("iterate flashcard entity list: %w", err)
	}
	return ret, nil
}
