// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"sort"
	"strings"
)

type OrderedSourceSnapshot struct {
	SourceRevision EntityRevision  `json:"sourceRevision"`
	References     []CardSourceRef `json:"references"`
}

// OrderedSourceSnapshot 同锁读取源修订与引用，不创建任何实体。
func (store *Store) OrderedSourceSnapshot(ctx context.Context, sourceID string) (OrderedSourceSnapshot, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed || strings.TrimSpace(sourceID) == "" {
		return OrderedSourceSnapshot{}, errors.New("ordered source is unavailable")
	}
	revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if !found || revision.Deleted {
		return OrderedSourceSnapshot{}, ErrEntityNotFound
	}
	conflicted, err := store.projection.entityHasUnresolvedConflict(ctx, EntityCardSource, sourceID)
	if err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if conflicted {
		return OrderedSourceSnapshot{}, ErrRevisionConflict
	}
	var source CardSource
	if err = decodeStrictJSON(revision.Payload, &source); err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if source.SchemaID != advancedSchemaID || source.SourceType != "ordered" || source.Status == "deleted" || source.PluginNamespace != "" {
		return OrderedSourceSnapshot{}, errors.New("source is not a built-in ordered source")
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if err = config.validate(); err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if len(config.Steps) > 1000 {
		return OrderedSourceSnapshot{}, errors.New("too many ordered steps")
	}
	refs, err := store.projection.CardSourceReferences(ctx, sourceID)
	if err != nil {
		return OrderedSourceSnapshot{}, err
	}
	if len(refs) == 0 || len(refs) > 1000 {
		return OrderedSourceSnapshot{}, errors.New("ordered source requires 1 to 1000 references")
	}
	for _, ref := range refs {
		if ref.EntityType != "block" || ref.SourceID != sourceID {
			return OrderedSourceSnapshot{}, errors.New("unsupported ordered source reference")
		}
		conflicted, err = store.projection.entityHasUnresolvedConflict(ctx, EntityCardSourceRef, ref.ID)
		if err != nil {
			return OrderedSourceSnapshot{}, err
		}
		if conflicted {
			return OrderedSourceSnapshot{}, ErrRevisionConflict
		}
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].ID < refs[j].ID })
	return OrderedSourceSnapshot{SourceRevision: revision, References: refs}, nil
}

// ReplayReorderAdvancedSource 只查询已完成操作，权限由调用方在返回结果前校验。
func (store *Store) ReplayReorderAdvancedSource(ctx context.Context, request ReorderAdvancedSourceRequest) (ReorderAdvancedSourceResult, bool, error) {
	if err := request.Validate(); err != nil {
		return ReorderAdvancedSourceResult{}, false, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return ReorderAdvancedSourceResult{}, false, errors.New("flashcard store is closed")
	}
	batch, found, err := store.findAppliedOperationLocked(ctx, request.OperationID)
	if err != nil || !found {
		return ReorderAdvancedSourceResult{}, found, err
	}
	result, err := store.reorderedSourceResult(ctx, batch, request)
	return result, true, err
}
