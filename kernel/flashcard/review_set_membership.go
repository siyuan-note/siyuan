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
	"sort"
	"strings"
)

// SetReviewSetMembershipsRequest 原子设置多张卡片在复习集中的手动纳入或排除状态。
type SetReviewSetMembershipsRequest struct {
	OperationID string         `json:"operationID"`
	ReviewSetID string         `json:"reviewSetID"`
	CardIDs     []string       `json:"cardIDs"`
	Mode        MembershipMode `json:"mode"`
	ChangedAt   int64          `json:"changedAt"`
}

// SetReviewSetMembershipsResult 返回最终成员实体和权威批次。
type SetReviewSetMembershipsResult struct {
	Batch          OperationBatch                 `json:"batch"`
	Memberships    map[string]ReviewSetMembership `json:"memberships"`
	ClearedCardIDs []string                       `json:"clearedCardIDs"`
}

// SetReviewSetMemberships 为每个复习集和卡片对复用既有实体 ID，避免不同创建入口产生重复关系。
func (store *Store) SetReviewSetMemberships(ctx context.Context,
	request SetReviewSetMembershipsRequest) (SetReviewSetMembershipsResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return SetReviewSetMembershipsResult{}, errors.New("flashcard store is closed")
	}
	if err := request.validate(); err != nil {
		return SetReviewSetMembershipsResult{}, err
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return SetReviewSetMembershipsResult{}, err
	} else if found {
		return store.reviewSetMembershipsFromBatch(ctx, existing, request)
	}
	if revision, found, err := store.projection.CurrentEntity(ctx, EntityReviewSet, request.ReviewSetID); err != nil || !found || revision.Deleted {
		if err != nil {
			return SetReviewSetMembershipsResult{}, err
		}
		return SetReviewSetMembershipsResult{}, ErrEntityNotFound
	}
	cardIDs := append([]string(nil), request.CardIDs...)
	sort.Strings(cardIDs)
	changes := make([]Change, 0, len(cardIDs))
	for _, cardID := range cardIDs {
		if revision, found, err := store.projection.CurrentEntity(ctx, EntityCard, cardID); err != nil || !found || revision.Deleted {
			if err != nil {
				return SetReviewSetMembershipsResult{}, err
			}
			return SetReviewSetMembershipsResult{}, ErrEntityNotFound
		}
		membershipID, parentRevisionID, err := store.projection.currentReviewSetMembership(ctx,
			request.ReviewSetID, cardID)
		if err != nil {
			return SetReviewSetMembershipsResult{}, err
		}
		if membershipID == "" {
			membershipID = DeterministicID("review-set-membership", request.ReviewSetID, cardID)
		}
		parents := []string(nil)
		if parentRevisionID != "" {
			parents = []string{parentRevisionID}
		}
		deleted := request.Mode == MembershipAutomatic
		payload := any(map[string]any{})
		if !deleted {
			payload = ReviewSetMembership{ID: membershipID, ReviewSetID: request.ReviewSetID, CardID: cardID,
				Mode: request.Mode}
		}
		revision, err := NewOperationEntityRevision(request.OperationID, EntityReviewSetMembership,
			membershipID, parents, request.ChangedAt, deleted, payload)
		if err != nil {
			return SetReviewSetMembershipsResult{}, err
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if err := store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return SetReviewSetMembershipsResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return SetReviewSetMembershipsResult{}, err
	}
	return store.reviewSetMembershipsFromBatch(ctx, batch, request)
}

func (request *SetReviewSetMembershipsRequest) validate() error {
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.ReviewSetID) == "" ||
		request.ChangedAt <= 0 || len(request.CardIDs) == 0 {
		return errors.New("flashcard review set membership operation is incomplete")
	}
	if request.Mode != MembershipInclude && request.Mode != MembershipExclude && request.Mode != MembershipAutomatic {
		return fmt.Errorf("unsupported review set membership mode [%s]", request.Mode)
	}
	seen := make(map[string]struct{}, len(request.CardIDs))
	for _, cardID := range request.CardIDs {
		if strings.TrimSpace(cardID) == "" {
			return errors.New("flashcard review set membership card ID is required")
		}
		if _, found := seen[cardID]; found {
			return fmt.Errorf("duplicate review set membership card [%s]", cardID)
		}
		seen[cardID] = struct{}{}
	}
	return nil
}

func (projection *Projection) currentReviewSetMembership(ctx context.Context, reviewSetID,
	cardID string) (membershipID, revisionID string, err error) {
	err = projection.db.QueryRowContext(ctx, `SELECT membership.id, entity.revision_id
		FROM review_set_memberships membership
		JOIN entities entity ON entity.entity_type = ? AND entity.entity_id = membership.id AND entity.deleted = 0
		WHERE membership.review_set_id = ? AND membership.card_id = ?`, EntityReviewSetMembership, reviewSetID,
		cardID).Scan(&membershipID, &revisionID)
	if errors.Is(err, sql.ErrNoRows) {
		membershipID = DeterministicID("review-set-membership", reviewSetID, cardID)
		revision, found, currentErr := projection.CurrentEntity(ctx, EntityReviewSetMembership, membershipID)
		if currentErr != nil {
			return "", "", currentErr
		}
		if found {
			return membershipID, revision.RevisionID, nil
		}
		return "", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("query current review set membership: %w", err)
	}
	return membershipID, revisionID, nil
}

func (store *Store) reviewSetMembershipsFromBatch(ctx context.Context, batch OperationBatch,
	request SetReviewSetMembershipsRequest) (SetReviewSetMembershipsResult, error) {
	if len(batch.Changes) != len(request.CardIDs) {
		return SetReviewSetMembershipsResult{}, ErrOperationConflict
	}
	expected := make(map[string]struct{}, len(request.CardIDs))
	for _, cardID := range request.CardIDs {
		expected[cardID] = struct{}{}
	}
	result := SetReviewSetMembershipsResult{Batch: batch,
		Memberships: make(map[string]ReviewSetMembership, len(request.CardIDs)), ClearedCardIDs: []string{}}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil ||
			change.Revision.EntityType != EntityReviewSetMembership ||
			change.Revision.UpdatedAt != request.ChangedAt {
			return SetReviewSetMembershipsResult{}, ErrOperationConflict
		}
		if request.Mode == MembershipAutomatic {
			cardID, err := store.clearedReviewSetMembershipCardID(ctx, *change.Revision, request)
			if err != nil {
				return SetReviewSetMembershipsResult{}, err
			}
			if _, found := expected[cardID]; !found || !change.Revision.Deleted {
				return SetReviewSetMembershipsResult{}, ErrOperationConflict
			}
			delete(expected, cardID)
			result.ClearedCardIDs = append(result.ClearedCardIDs, cardID)
			continue
		}
		if change.Revision.Deleted {
			return SetReviewSetMembershipsResult{}, ErrOperationConflict
		}
		var membership ReviewSetMembership
		if err := decodeStrictJSON(change.Revision.Payload, &membership); err != nil {
			return SetReviewSetMembershipsResult{}, ErrOperationConflict
		}
		if _, found := expected[membership.CardID]; !found || membership.ReviewSetID != request.ReviewSetID ||
			membership.Mode != request.Mode {
			return SetReviewSetMembershipsResult{}, ErrOperationConflict
		}
		delete(expected, membership.CardID)
		result.Memberships[membership.CardID] = membership
	}
	if len(expected) != 0 {
		return SetReviewSetMembershipsResult{}, ErrOperationConflict
	}
	sort.Strings(result.ClearedCardIDs)
	return result, nil
}

func (store *Store) clearedReviewSetMembershipCardID(ctx context.Context, revision EntityRevision,
	request SetReviewSetMembershipsRequest) (string, error) {
	for _, cardID := range request.CardIDs {
		if revision.EntityID == DeterministicID("review-set-membership", request.ReviewSetID, cardID) {
			return cardID, nil
		}
	}
	if len(revision.ParentRevisionIDs) != 1 {
		return "", ErrOperationConflict
	}
	parent, found, err := store.projection.entityRevisionByID(ctx, revision.ParentRevisionIDs[0])
	if err != nil {
		return "", err
	}
	if !found || parent.Deleted || parent.EntityType != EntityReviewSetMembership {
		return "", ErrOperationConflict
	}
	var membership ReviewSetMembership
	if err = decodeStrictJSON(parent.Payload, &membership); err != nil {
		return "", ErrOperationConflict
	}
	if membership.ID != revision.EntityID || membership.ReviewSetID != request.ReviewSetID {
		return "", ErrOperationConflict
	}
	return membership.CardID, nil
}
