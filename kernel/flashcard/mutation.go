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
	"strings"
)

var (
	// ErrEntityNotFound 表示修改目标不存在或已经被删除。
	ErrEntityNotFound = errors.New("flashcard entity was not found")

	// ErrRevisionConflict 表示调用方提供的预期修订已经过期。
	ErrRevisionConflict = errors.New("flashcard entity revision conflict")
)

// EntityMutation 描述同一次用户操作中的一项实体创建、更新或删除。
type EntityMutation struct {
	EntityType         EntityType      `json:"entityType"`
	EntityID           string          `json:"entityID"`
	ExpectedRevisionID string          `json:"expectedRevisionID,omitempty"`
	RequireAbsent      bool            `json:"requireAbsent,omitempty"`
	UpdatedAt          int64           `json:"updatedAt"`
	Deleted            bool            `json:"deleted"`
	Payload            json.RawMessage `json:"payload,omitempty"`
}

// EntityMutationResult 返回修改后可以继续用于乐观并发的实体修订。
type EntityMutationResult struct {
	Batch     OperationBatch   `json:"batch"`
	Revisions []EntityRevision `json:"revisions"`
}

// MutateEntities 将多个实体修改作为一个权威批次原子持久化。
func (store *Store) MutateEntities(ctx context.Context, operationID string,
	mutations []EntityMutation) (EntityMutationResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return EntityMutationResult{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(operationID) == "" || len(mutations) == 0 {
		return EntityMutationResult{}, errors.New("flashcard mutation operation and entities are required")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, operationID); err != nil {
		return EntityMutationResult{}, err
	} else if found {
		return mutationResultFromBatch(existing, mutations)
	}

	seen := make(map[string]struct{}, len(mutations))
	changes := make([]Change, 0, len(mutations))
	for _, mutation := range mutations {
		key := string(mutation.EntityType) + "\x00" + mutation.EntityID
		if _, duplicate := seen[key]; duplicate {
			return EntityMutationResult{}, fmt.Errorf("duplicate flashcard mutation target [%s:%s]",
				mutation.EntityType, mutation.EntityID)
		}
		seen[key] = struct{}{}
		if strings.TrimSpace(string(mutation.EntityType)) == "" || strings.TrimSpace(mutation.EntityID) == "" ||
			mutation.UpdatedAt < 0 {
			return EntityMutationResult{}, errors.New("flashcard mutation identity and timestamp are invalid")
		}

		current, found, err := store.projection.CurrentEntity(ctx, mutation.EntityType, mutation.EntityID)
		if err != nil {
			return EntityMutationResult{}, err
		}
		if mutation.RequireAbsent && found {
			return EntityMutationResult{}, fmt.Errorf("%w: entity [%s:%s] already exists", ErrRevisionConflict,
				mutation.EntityType, mutation.EntityID)
		}
		if mutation.ExpectedRevisionID != "" && (!found || current.RevisionID != mutation.ExpectedRevisionID) {
			return EntityMutationResult{}, fmt.Errorf("%w: expected [%s]", ErrRevisionConflict,
				mutation.ExpectedRevisionID)
		}
		if mutation.Deleted && (!found || current.Deleted) {
			return EntityMutationResult{}, ErrEntityNotFound
		}

		payload := mutation.Payload
		parents := []string(nil)
		if found {
			parents = []string{current.RevisionID}
			if mutation.Deleted {
				payload = json.RawMessage(`{}`)
			}
		} else if mutation.Deleted {
			return EntityMutationResult{}, ErrEntityNotFound
		}
		if len(payload) == 0 || !json.Valid(payload) {
			return EntityMutationResult{}, errors.New("flashcard mutation payload must be valid JSON")
		}
		revision, err := NewOperationEntityRevision(operationID, mutation.EntityType, mutation.EntityID, parents,
			mutation.UpdatedAt, mutation.Deleted, payload)
		if err != nil {
			return EntityMutationResult{}, err
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if err := store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return EntityMutationResult{}, err
	}
	batch, err := store.applyLocked(ctx, operationID, changes)
	if err != nil {
		return EntityMutationResult{}, err
	}
	return mutationResultFromBatch(batch, mutations)
}

func mutationResultFromBatch(batch OperationBatch, mutations []EntityMutation) (EntityMutationResult, error) {
	if len(batch.Changes) != len(mutations) {
		return EntityMutationResult{}, ErrOperationConflict
	}
	requested := make(map[string]EntityMutation, len(mutations))
	for _, mutation := range mutations {
		key := string(mutation.EntityType) + "\x00" + mutation.EntityID
		if _, duplicate := requested[key]; duplicate {
			return EntityMutationResult{}, ErrOperationConflict
		}
		requested[key] = mutation
	}
	result := EntityMutationResult{Batch: batch, Revisions: make([]EntityRevision, 0, len(mutations))}
	for _, change := range batch.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil {
			return EntityMutationResult{}, ErrOperationConflict
		}
		revision := *change.Revision
		key := string(revision.EntityType) + "\x00" + revision.EntityID
		mutation, found := requested[key]
		if !found || revision.UpdatedAt != mutation.UpdatedAt || revision.Deleted != mutation.Deleted {
			return EntityMutationResult{}, ErrOperationConflict
		}
		if mutation.ExpectedRevisionID != "" && (len(revision.ParentRevisionIDs) != 1 ||
			revision.ParentRevisionIDs[0] != mutation.ExpectedRevisionID) {
			return EntityMutationResult{}, ErrOperationConflict
		}
		if mutation.RequireAbsent && len(revision.ParentRevisionIDs) != 0 {
			return EntityMutationResult{}, ErrOperationConflict
		}
		if !mutation.Deleted {
			canonical, err := canonicalRawMessage(mutation.Payload)
			if err != nil || string(canonical) != string(revision.Payload) {
				return EntityMutationResult{}, ErrOperationConflict
			}
		}
		delete(requested, key)
		result.Revisions = append(result.Revisions, revision)
	}
	if len(requested) != 0 {
		return EntityMutationResult{}, ErrOperationConflict
	}
	return result, nil
}
