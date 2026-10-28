// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

var builtinLeechTagID = DeterministicID("builtin", "leech-tag")

// SaveTagRequest 创建、重命名或移动一个闪卡标签。
type SaveTagRequest struct {
	OperationID        string `json:"operationID"`
	TagID              string `json:"tagID"`
	ParentID           string `json:"parentID,omitempty"`
	Name               string `json:"name"`
	ExpectedRevisionID string `json:"expectedRevisionID,omitempty"`
	UpdatedAt          int64  `json:"updatedAt"`
}

// NormalizeTagName 生成用于同级唯一约束的稳定标签名称。
func NormalizeTagName(name string) string {
	return cases.Fold().String(norm.NFKC.String(strings.TrimSpace(name)))
}

// SaveTag 将标签创建、重命名或移动保存为一个可幂等重试的实体修订。
func (store *Store) SaveTag(ctx context.Context, request SaveTagRequest) (EntityRevision, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return EntityRevision{}, errors.New("flashcard store is closed")
	}
	request.OperationID = strings.TrimSpace(request.OperationID)
	request.TagID = strings.TrimSpace(request.TagID)
	request.ParentID = strings.TrimSpace(request.ParentID)
	request.Name = strings.TrimSpace(request.Name)
	request.ExpectedRevisionID = strings.TrimSpace(request.ExpectedRevisionID)
	if request.OperationID == "" || request.TagID == "" || request.Name == "" || request.UpdatedAt <= 0 {
		return EntityRevision{}, errors.New("flashcard tag save request is invalid")
	}
	tag := Tag{ID: request.TagID, ParentID: request.ParentID, Name: request.Name,
		NormalizedName: NormalizeTagName(request.Name)}
	if existing, found, err := store.findAppliedOperationLocked(ctx, request.OperationID); err != nil {
		return EntityRevision{}, err
	} else if found {
		return savedTagFromBatch(existing, request, tag)
	}
	current, found, err := store.projection.CurrentEntity(ctx, EntityTag, request.TagID)
	if err != nil {
		return EntityRevision{}, err
	}
	parents := []string(nil)
	if found {
		if request.ExpectedRevisionID == "" || current.RevisionID != request.ExpectedRevisionID {
			return EntityRevision{}, fmt.Errorf("%w: tag [%s]", ErrRevisionConflict, request.TagID)
		}
		parents = []string{current.RevisionID}
	} else if request.ExpectedRevisionID != "" {
		return EntityRevision{}, fmt.Errorf("%w: tag [%s]", ErrRevisionConflict, request.TagID)
	}
	revision, err := NewOperationEntityRevision(request.OperationID, EntityTag, tag.ID, parents,
		request.UpdatedAt, false, tag)
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
	return savedTagFromBatch(batch, request, tag)
}

func savedTagFromBatch(batch OperationBatch, request SaveTagRequest, tag Tag) (EntityRevision, error) {
	if len(batch.Changes) != 1 || batch.Changes[0].Kind != RecordEntityRevision ||
		batch.Changes[0].Revision == nil {
		return EntityRevision{}, ErrOperationConflict
	}
	revision := *batch.Changes[0].Revision
	if revision.EntityType != EntityTag || revision.EntityID != request.TagID ||
		revision.UpdatedAt != request.UpdatedAt || revision.Deleted {
		return EntityRevision{}, ErrOperationConflict
	}
	if request.ExpectedRevisionID == "" {
		if len(revision.ParentRevisionIDs) != 0 {
			return EntityRevision{}, ErrOperationConflict
		}
	} else if len(revision.ParentRevisionIDs) != 1 || revision.ParentRevisionIDs[0] != request.ExpectedRevisionID {
		return EntityRevision{}, ErrOperationConflict
	}
	canonical, err := CanonicalJSON(tag)
	if err != nil || string(canonical) != string(revision.Payload) {
		return EntityRevision{}, ErrOperationConflict
	}
	return revision, nil
}
