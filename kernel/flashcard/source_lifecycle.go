// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const (
	SourceActionDelete  = "delete"
	SourceActionRestore = "restore"
)

// SourceLifecycleRequest 描述卡源软删除或恢复操作。
type SourceLifecycleRequest struct {
	OperationID      string `json:"operationID"`
	SourceID         string `json:"sourceID"`
	Action           string `json:"action"`
	ExpectedRevision string `json:"expectedRevision,omitempty"`
	ChangedAt        int64  `json:"changedAt"`
}

// SourceLifecycleResult 返回卡源的新修订；删除不修改排期和复习历史。
type SourceLifecycleResult struct {
	Batch          *OperationBatch `json:"batch,omitempty"`
	SourceRevision EntityRevision  `json:"sourceRevision"`
}

// ManageSourceLifecycle 通过卡源状态控制整组卡片是否可复习，并保留卡片原生成状态。
func (store *Store) ManageSourceLifecycle(ctx context.Context,
	request SourceLifecycleRequest) (SourceLifecycleResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return SourceLifecycleResult{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || strings.TrimSpace(request.SourceID) == "" ||
		request.ChangedAt <= 0 || (request.Action != SourceActionDelete && request.Action != SourceActionRestore) {
		return SourceLifecycleResult{}, errors.New("flashcard source lifecycle request is invalid")
	}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return SourceLifecycleResult{}, err
	} else if found {
		return sourceLifecycleResultFromBatch(existing, request)
	}
	conflicted, err := store.projection.entityHasUnresolvedConflict(ctx, EntityCardSource, request.SourceID)
	if err != nil {
		return SourceLifecycleResult{}, err
	}
	if conflicted {
		return SourceLifecycleResult{}, fmt.Errorf("flashcard source [%s] has an unresolved entity conflict",
			request.SourceID)
	}
	current, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil {
		return SourceLifecycleResult{}, err
	}
	if !found || current.Deleted {
		return SourceLifecycleResult{}, ErrEntityNotFound
	}
	if request.ExpectedRevision != "" && request.ExpectedRevision != current.RevisionID {
		return SourceLifecycleResult{}, fmt.Errorf("%w: expected [%s]", ErrRevisionConflict, request.ExpectedRevision)
	}
	var source CardSource
	if err = decodeStrictJSON(current.Payload, &source); err != nil {
		return SourceLifecycleResult{}, err
	}
	desiredStatus := "deleted"
	if request.Action == SourceActionRestore {
		desiredStatus = "active"
	}
	if source.Status == desiredStatus {
		return SourceLifecycleResult{SourceRevision: current}, nil
	}
	source.Status = desiredStatus
	revision, err := NewOperationEntityRevision(request.OperationID, EntityCardSource, request.SourceID,
		[]string{current.RevisionID}, request.ChangedAt, false, source)
	if err != nil {
		return SourceLifecycleResult{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &revision}}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return SourceLifecycleResult{}, err
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		return SourceLifecycleResult{}, err
	}
	return SourceLifecycleResult{Batch: &batch, SourceRevision: revision}, nil
}

func sourceLifecycleResultFromBatch(batch OperationBatch,
	request SourceLifecycleRequest) (SourceLifecycleResult, error) {
	if len(batch.Changes) != 1 || batch.Changes[0].Kind != RecordEntityRevision ||
		batch.Changes[0].Revision == nil {
		return SourceLifecycleResult{}, ErrOperationConflict
	}
	revision := *batch.Changes[0].Revision
	if revision.EntityType != EntityCardSource || revision.EntityID != request.SourceID || revision.Deleted ||
		revision.UpdatedAt != request.ChangedAt {
		return SourceLifecycleResult{}, ErrOperationConflict
	}
	var source CardSource
	if err := decodeStrictJSON(revision.Payload, &source); err != nil {
		return SourceLifecycleResult{}, err
	}
	expectedStatus := "deleted"
	if request.Action == SourceActionRestore {
		expectedStatus = "active"
	}
	if source.Status != expectedStatus {
		return SourceLifecycleResult{}, ErrOperationConflict
	}
	return SourceLifecycleResult{Batch: &batch, SourceRevision: revision}, nil
}
