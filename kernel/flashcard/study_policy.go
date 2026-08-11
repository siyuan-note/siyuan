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
	"strings"
)

// SaveStudyPolicyRequest 创建或更新一个文档或笔记本范围策略。
type SaveStudyPolicyRequest struct {
	OperationID        string `json:"operationID"`
	ScopeType          string `json:"scopeType"`
	ScopeID            string `json:"scopeID"`
	Priority           string `json:"priority"`
	TargetDate         *int64 `json:"targetDate,omitempty"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty"`
	UpdatedAt          int64  `json:"updatedAt"`
}

// StudyPolicyRevision 按唯一范围返回当前策略修订。
func (projection *Projection) StudyPolicyRevision(ctx context.Context, scopeType,
	scopeID string) (EntityRevision, bool, error) {
	var entityID string
	err := projection.db.QueryRowContext(ctx, `SELECT id FROM study_policies
		WHERE scope_type = ? AND scope_id = ?`, scopeType, scopeID).Scan(&entityID)
	if errors.Is(err, sql.ErrNoRows) {
		return EntityRevision{}, false, nil
	}
	if err != nil {
		return EntityRevision{}, false, fmt.Errorf("query flashcard study policy scope: %w", err)
	}
	return projection.CurrentEntity(ctx, EntityStudyPolicy, entityID)
}

// SaveStudyPolicy 复用范围的稳定实体身份，并通过预期修订保护并发更新。
func (store *Store) SaveStudyPolicy(ctx context.Context,
	request SaveStudyPolicyRequest) (EntityRevision, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return EntityRevision{}, errors.New("flashcard store is closed")
	}
	request.OperationID = strings.TrimSpace(request.OperationID)
	request.ScopeType = strings.TrimSpace(request.ScopeType)
	request.ScopeID = strings.TrimSpace(request.ScopeID)
	request.Priority = strings.TrimSpace(request.Priority)
	request.ExpectedRevisionID = strings.TrimSpace(request.ExpectedRevisionID)
	if request.OperationID == "" || request.ScopeID == "" || request.UpdatedAt <= 0 ||
		(request.ScopeType != "document" && request.ScopeType != "notebook") ||
		!validStudyPriority(request.Priority) || request.TargetDate != nil && *request.TargetDate < 0 {
		return EntityRevision{}, errors.New("flashcard study policy save request is invalid")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return EntityRevision{}, err
	} else if found {
		return savedStudyPolicyFromBatch(existing, request)
	}
	current, found, err := store.projection.StudyPolicyRevision(ctx, request.ScopeType, request.ScopeID)
	if err != nil {
		return EntityRevision{}, err
	}
	parents := []string(nil)
	policyID := DeterministicID("study-policy", request.ScopeType, request.ScopeID)
	createdAt := request.UpdatedAt
	if found {
		if request.ExpectedRevisionID == "" || current.RevisionID != request.ExpectedRevisionID {
			return EntityRevision{}, fmt.Errorf("%w: study policy [%s:%s]", ErrRevisionConflict,
				request.ScopeType, request.ScopeID)
		}
		parents = []string{current.RevisionID}
		policyID = current.EntityID
		var currentPolicy StudyPolicy
		if err = decodeStrictJSON(current.Payload, &currentPolicy); err != nil {
			return EntityRevision{}, err
		}
		createdAt = currentPolicy.CreatedAt
	} else if request.ExpectedRevisionID != "" {
		return EntityRevision{}, fmt.Errorf("%w: study policy [%s:%s]", ErrRevisionConflict,
			request.ScopeType, request.ScopeID)
	}
	policy := StudyPolicy{ID: policyID, ScopeType: request.ScopeType, ScopeID: request.ScopeID,
		Priority: request.Priority, TargetDate: request.TargetDate, CreatedAt: createdAt, UpdatedAt: request.UpdatedAt}
	revision, err := NewOperationEntityRevision(request.OperationID, EntityStudyPolicy, policy.ID, parents,
		request.UpdatedAt, false, policy)
	if err != nil {
		return EntityRevision{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &revision}}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return EntityRevision{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return EntityRevision{}, err
	}
	return savedStudyPolicyFromBatch(batch, request)
}

func savedStudyPolicyFromBatch(batch OperationBatch, request SaveStudyPolicyRequest) (EntityRevision, error) {
	if len(batch.Changes) != 1 || batch.Changes[0].Kind != RecordEntityRevision ||
		batch.Changes[0].Revision == nil || batch.Changes[0].Revision.Deleted {
		return EntityRevision{}, ErrOperationConflict
	}
	revision := *batch.Changes[0].Revision
	if revision.EntityType != EntityStudyPolicy || revision.UpdatedAt != request.UpdatedAt {
		return EntityRevision{}, ErrOperationConflict
	}
	if request.ExpectedRevisionID == "" {
		if len(revision.ParentRevisionIDs) != 0 {
			return EntityRevision{}, ErrOperationConflict
		}
	} else if len(revision.ParentRevisionIDs) != 1 || revision.ParentRevisionIDs[0] != request.ExpectedRevisionID {
		return EntityRevision{}, ErrOperationConflict
	}
	var policy StudyPolicy
	if decodeStrictJSON(revision.Payload, &policy) != nil || policy.ID != revision.EntityID ||
		policy.ScopeType != request.ScopeType || policy.ScopeID != request.ScopeID ||
		policy.Priority != request.Priority || !sameOptionalInt64(policy.TargetDate, request.TargetDate) ||
		policy.UpdatedAt != request.UpdatedAt {
		return EntityRevision{}, ErrOperationConflict
	}
	return revision, nil
}

func sameOptionalInt64(left, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
