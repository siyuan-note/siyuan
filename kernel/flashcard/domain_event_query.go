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
	"fmt"
	"strings"
)

// DomainEvents 返回指定类型的不可变领域事件，并使用稳定顺序。
func (projection *Projection) DomainEvents(ctx context.Context, eventTypes ...string) ([]Event, error) {
	if len(eventTypes) == 0 {
		return []Event{}, nil
	}
	placeholders := make([]string, len(eventTypes))
	args := make([]any, len(eventTypes))
	for index, eventType := range eventTypes {
		if strings.TrimSpace(eventType) == "" {
			return nil, fmt.Errorf("flashcard domain event type at index [%d] is empty", index)
		}
		placeholders[index] = "?"
		args[index] = eventType
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT event_type, event_id, entity_id, occurred_at, payload
		FROM events WHERE event_type IN (`+strings.Join(placeholders, ",")+`) ORDER BY occurred_at, event_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("query flashcard domain events: %w", err)
	}
	defer rows.Close()
	ret := make([]Event, 0)
	for rows.Next() {
		var event Event
		var payload []byte
		if err = rows.Scan(&event.EventType, &event.EventID, &event.EntityID, &event.OccurredAt, &payload); err != nil {
			return nil, fmt.Errorf("scan flashcard domain event: %w", err)
		}
		event.Payload = json.RawMessage(payload)
		ret = append(ret, event)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard domain events: %w", err)
	}
	return ret, nil
}
