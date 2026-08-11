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
	"errors"
	"fmt"
)

// CardRenderModel 提供声明式渲染所需的卡片、模板、卡型和有序内容引用。
type CardRenderModel struct {
	Card        Card            `json:"card"`
	ReviewState ReviewState     `json:"reviewState"`
	Source      CardSource      `json:"source"`
	References  []CardSourceRef `json:"references"`
	Template    CardTemplate    `json:"template"`
	Schema      CardSchema      `json:"schema"`
}

// CardRenderModel 返回一张卡片的完整声明式渲染模型，不读取或复制块内容。
func (projection *Projection) CardRenderModel(ctx context.Context, cardID string) (CardRenderModel, error) {
	cardRevision, found, err := projection.CurrentEntity(ctx, EntityCard, cardID)
	if err != nil || !found || cardRevision.Deleted {
		if err != nil {
			return CardRenderModel{}, err
		}
		return CardRenderModel{}, ErrEntityNotFound
	}
	var ret CardRenderModel
	if err = decodeStrictJSON(cardRevision.Payload, &ret.Card); err != nil {
		return CardRenderModel{}, err
	}
	stateRevision, found, err := projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || stateRevision.Deleted {
		if err != nil {
			return CardRenderModel{}, err
		}
		return CardRenderModel{}, errors.New("flashcard render model has no review state")
	}
	if err = decodeStrictJSON(stateRevision.Payload, &ret.ReviewState); err != nil {
		return CardRenderModel{}, err
	}
	sourceRevision, found, err := projection.CurrentEntity(ctx, EntityCardSource, ret.Card.SourceID)
	if err != nil || !found || sourceRevision.Deleted {
		if err != nil {
			return CardRenderModel{}, err
		}
		return CardRenderModel{}, errors.New("flashcard render model has no source")
	}
	if err = decodeStrictJSON(sourceRevision.Payload, &ret.Source); err != nil {
		return CardRenderModel{}, err
	}
	templateRevision, found, err := projection.CurrentEntity(ctx, EntityCardTemplate, ret.Card.TemplateID)
	if err != nil || !found || templateRevision.Deleted {
		if err != nil {
			return CardRenderModel{}, err
		}
		return CardRenderModel{}, errors.New("flashcard render model has no template")
	}
	if err = decodeStrictJSON(templateRevision.Payload, &ret.Template); err != nil {
		return CardRenderModel{}, err
	}
	schemaRevision, found, err := projection.CurrentEntity(ctx, EntityCardSchema, ret.Source.SchemaID)
	if err != nil || !found || schemaRevision.Deleted {
		if err != nil {
			return CardRenderModel{}, err
		}
		return CardRenderModel{}, errors.New("flashcard render model has no schema")
	}
	if err = decodeStrictJSON(schemaRevision.Payload, &ret.Schema); err != nil {
		return CardRenderModel{}, err
	}
	ret.References, err = projection.CardSourceReferences(ctx, ret.Source.ID)
	if err != nil {
		return CardRenderModel{}, err
	}
	if len(ret.References) == 0 {
		return CardRenderModel{}, errors.New("flashcard render model has no content references")
	}
	return ret, nil
}

// CardSourceReferences 按显示顺序返回卡源的全部当前引用。
func (projection *Projection) CardSourceReferences(ctx context.Context, sourceID string) ([]CardSourceRef, error) {
	rows, err := projection.db.QueryContext(ctx, `SELECT e.payload FROM card_source_refs r
		JOIN entities e ON e.entity_type = ? AND e.entity_id = r.id AND e.deleted = 0
		WHERE r.source_id = ? ORDER BY r.sort, r.id`, EntityCardSourceRef, sourceID)
	if err != nil {
		return nil, fmt.Errorf("query flashcard source references: %w", err)
	}
	defer rows.Close()
	ret := make([]CardSourceRef, 0)
	for rows.Next() {
		var payload []byte
		if err = rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("scan flashcard source reference: %w", err)
		}
		var reference CardSourceRef
		if err = decodeStrictJSON(payload, &reference); err != nil {
			return nil, err
		}
		ret = append(ret, reference)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard source references: %w", err)
	}
	return ret, nil
}
