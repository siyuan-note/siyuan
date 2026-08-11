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
	"errors"
	"fmt"
	"sort"
	"strings"
)

// OperationRevisionID 返回同一幂等操作修改指定实体时使用的稳定修订 ID。
func OperationRevisionID(operationID string, entityType EntityType, entityID string) string {
	return DeterministicID("entity-revision", operationID, string(entityType), entityID)
}

// NewOperationEntityRevision 创建在 API 重试时保持相同身份的实体修订。
func NewOperationEntityRevision(operationID string, entityType EntityType, entityID string, parents []string,
	updatedAt int64, deleted bool, payload any) (EntityRevision, error) {
	if strings.TrimSpace(operationID) == "" {
		return EntityRevision{}, errors.New("operation ID is required")
	}
	canonicalPayload, err := CanonicalJSON(payload)
	if err != nil {
		return EntityRevision{}, fmt.Errorf("canonicalize entity payload: %w", err)
	}
	sortedParents := append([]string(nil), parents...)
	sort.Strings(sortedParents)
	revision := EntityRevision{
		EntityType:        entityType,
		EntityID:          entityID,
		RevisionID:        OperationRevisionID(operationID, entityType, entityID),
		ParentRevisionIDs: sortedParents,
		UpdatedAt:         updatedAt,
		Deleted:           deleted,
		Payload:           canonicalPayload,
	}
	if err = revision.Validate(); err != nil {
		return EntityRevision{}, err
	}
	return revision, nil
}

// ReviewEventID 返回一次幂等评分操作对应的稳定事件 ID。
func ReviewEventID(operationID, cardID string) string {
	return DeterministicID("review-event", operationID, cardID)
}

// NewReviewEvent 创建包含完整排期输入和前后状态的不可变复习事件。
func NewReviewEvent(operationID string, payload ReviewEventPayload) (Event, error) {
	if strings.TrimSpace(operationID) == "" {
		return Event{}, errors.New("operation ID is required")
	}
	canonicalPayload, err := CanonicalJSON(payload)
	if err != nil {
		return Event{}, fmt.Errorf("canonicalize review event payload: %w", err)
	}
	event := Event{
		EventType:  EventReview,
		EventID:    ReviewEventID(operationID, payload.CardID),
		EntityID:   payload.CardID,
		OccurredAt: payload.ReviewedAt,
		Payload:    canonicalPayload,
	}
	if err = event.Validate(); err != nil {
		return Event{}, err
	}
	return event, nil
}

// ReviewUndoEventID 返回一次幂等撤销操作对应的稳定事件 ID。
func ReviewUndoEventID(operationID, reviewEventID string) string {
	return DeterministicID("review-undo-event", operationID, reviewEventID)
}

// NewReviewUndoEvent 创建保留原始复习记录的不可变撤销事件。
func NewReviewUndoEvent(operationID string, payload ReviewUndoneEventPayload) (Event, error) {
	if strings.TrimSpace(operationID) == "" {
		return Event{}, errors.New("operation ID is required")
	}
	canonicalPayload, err := CanonicalJSON(payload)
	if err != nil {
		return Event{}, fmt.Errorf("canonicalize review undo event payload: %w", err)
	}
	event := Event{
		EventType:  EventReviewUndone,
		EventID:    ReviewUndoEventID(operationID, payload.ReviewEventID),
		EntityID:   payload.CardID,
		OccurredAt: payload.UndoneAt,
		Payload:    canonicalPayload,
	}
	if err = event.Validate(); err != nil {
		return Event{}, err
	}
	return event, nil
}
