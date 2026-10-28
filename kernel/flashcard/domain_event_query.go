// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (projection *Projection) eventExists(ctx context.Context, eventID string) (bool, error) {
	var found int
	if err := projection.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM events WHERE event_id = ?)",
		eventID).Scan(&found); err != nil {
		return false, err
	}
	return found != 0, nil
}

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
