package flashcard

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// SourceHistoryVersion 保存卡源修订及其因果链中对应的内容引用，不包含块正文快照。
type SourceHistoryVersion struct {
	Revision   EntityRevision  `json:"revision"`
	References []CardSourceRef `json:"references"`
	Modes      []string        `json:"modes"`
}

// SourceHistory 返回按时间分页排列的卡源修订。
func (projection *Projection) SourceHistory(ctx context.Context, sourceID string, limit, offset int) ([]EntityRevision, error) {
	if strings.TrimSpace(sourceID) == "" || limit < 1 || limit > 100 || offset < 0 {
		return nil, errors.New("invalid flashcard source history query")
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT revision_id FROM entity_revisions
		WHERE entity_type = ? AND entity_id = ? ORDER BY updated_at DESC, revision_id DESC LIMIT ? OFFSET ?`,
		EntityCardSource, sourceID, limit, offset)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	versions := make([]EntityRevision, 0, len(ids))
	for _, id := range ids {
		revision, found, queryErr := projection.entityRevisionByID(ctx, id)
		if queryErr != nil {
			return nil, queryErr
		}
		if !found {
			return nil, ErrEntityNotFound
		}
		versions = append(versions, revision)
	}
	return versions, nil
}

// SourceHistoryVersion 沿卡源父修订读取引用，避免使用设备时间拼接并发版本。
func (projection *Projection) SourceHistoryVersion(ctx context.Context, sourceID, revisionID string) (SourceHistoryVersion, error) {
	result := SourceHistoryVersion{References: make([]CardSourceRef, 0)}
	revision, found, err := projection.entityRevisionByID(ctx, revisionID)
	if err != nil {
		return result, err
	}
	if !found || revision.EntityType != EntityCardSource || revision.EntityID != sourceID || revision.Deleted {
		return result, ErrEntityNotFound
	}
	result.Revision = revision
	// 独立修改的引用没有卡源修订作为因果边界，不能将其归入某个配置版本。
	var independentReferences bool
	err = projection.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM entity_revisions r
		WHERE r.entity_type = ? AND r.entity_id IN (SELECT entity_id FROM entity_revisions
			WHERE entity_type = ? AND deleted = 0 AND json_extract(payload, '$.sourceID') = ?)
		AND NOT EXISTS(SELECT 1 FROM entity_revisions s WHERE s.batch_id = r.batch_id AND s.entity_type = ? AND s.entity_id = ?))`,
		EntityCardSourceRef, EntityCardSourceRef, sourceID, EntityCardSource, sourceID).Scan(&independentReferences)
	if err != nil {
		return result, err
	}
	if independentReferences {
		return result, errors.New("flashcard source history contains independently modified references")
	}
	rows, err := projection.db.QueryContext(ctx, `WITH RECURSIVE ancestors(id) AS (
		SELECT ? UNION SELECT parent_revision_id FROM revision_parents JOIN ancestors ON revision_id = ancestors.id
	), batches AS (SELECT batch_id FROM entity_revisions JOIN ancestors ON revision_id = ancestors.id)
	SELECT revision_id FROM entity_revisions WHERE entity_type = ? AND batch_id IN (SELECT batch_id FROM batches)`,
		revisionID, EntityCardSourceRef)
	if err != nil {
		return result, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return result, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	byEntity := map[string][]EntityRevision{}
	belongs := map[string]bool{}
	for _, id := range ids {
		refRevision, exists, queryErr := projection.entityRevisionByID(ctx, id)
		if queryErr != nil {
			return result, queryErr
		}
		if !exists {
			return result, ErrEntityNotFound
		}
		byEntity[refRevision.EntityID] = append(byEntity[refRevision.EntityID], refRevision)
		if !refRevision.Deleted {
			var ref CardSourceRef
			if err = decodeStrictJSON(refRevision.Payload, &ref); err != nil {
				return result, err
			}
			if ref.SourceID == sourceID {
				belongs[ref.ID] = true
			}
		}
	}
	for id := range belongs {
		parents := map[string]bool{}
		for _, candidate := range byEntity[id] {
			for _, parent := range candidate.ParentRevisionIDs {
				parents[parent] = true
			}
		}
		var candidates []EntityRevision
		for _, candidate := range byEntity[id] {
			if !parents[candidate.RevisionID] {
				candidates = append(candidates, candidate)
			}
		}
		var heads []EntityRevision
		for _, candidate := range candidates {
			ancestor := false
			for _, other := range candidates {
				if other.RevisionID == candidate.RevisionID {
					continue
				}
				isAncestor, queryErr := projection.isAncestor(ctx, candidate.RevisionID, other.RevisionID)
				if queryErr != nil {
					return result, queryErr
				}
				if isAncestor {
					ancestor = true
					break
				}
			}
			if !ancestor {
				heads = append(heads, candidate)
			}
		}
		if len(heads) != 1 {
			return result, ErrRevisionConflict
		}
		if heads[0].Deleted {
			continue
		}
		var ref CardSourceRef
		if err = decodeStrictJSON(heads[0].Payload, &ref); err != nil {
			return result, err
		}
		if ref.SourceID != sourceID {
			return result, ErrRevisionConflict
		}
		result.References = append(result.References, ref)
	}
	sort.Slice(result.References, func(i, j int) bool {
		if result.References[i].Sort != result.References[j].Sort {
			return result.References[i].Sort < result.References[j].Sort
		}
		return result.References[i].ID < result.References[j].ID
	})
	var source CardSource
	if err = decodeStrictJSON(revision.Payload, &source); err != nil {
		return result, err
	}
	result.Modes = sourceHistoryModes(source)
	for _, ref := range result.References {
		if ref.ID == source.PrimaryRefID {
			return result, nil
		}
	}
	return result, errors.New("historical flashcard source references are incomplete")
}

func sourceHistoryModes(source CardSource) []string {
	disabled := stringSet(source.DisabledTemplateIDs)
	var modes []string
	if source.SchemaID == basicSchemaID {
		for _, item := range []struct{ id, mode string }{{basicForwardTemplateID, "forward"}, {basicReverseTemplateID, "reverse"}} {
			if _, found := disabled[item.id]; !found {
				modes = append(modes, item.mode)
			}
		}
	} else if source.SchemaID == advancedSchemaID {
		for _, item := range []struct{ id, mode string }{{advancedClozeTemplateID, "cloze"}, {advancedOrderedSingleTemplateID, "orderedSingle"}, {advancedOrderedCardsTemplateID, "orderedCards"}} {
			if _, found := disabled[item.id]; !found {
				modes = append(modes, item.mode)
			}
		}
	} else {
		modes = append(modes, source.SourceType)
	}
	return modes
}

// RestoreSourceHistoryRequest 将历史配置作为新修订写入，保留当前排期及卡源管理状态。
type RestoreSourceHistoryRequest struct {
	OperationID        string                           `json:"operationID"`
	SourceID           string                           `json:"sourceID"`
	RevisionID         string                           `json:"revisionID"`
	ExpectedRevisionID string                           `json:"expectedRevisionID"`
	UpdatedAt          int64                            `json:"updatedAt"`
	ValidateVersion    func(SourceHistoryVersion) error `json:"-"`
}

// RestoreSourceHistory 原子恢复卡源配置、引用及稳定变体，已有复习状态不参与恢复。
func (store *Store) RestoreSourceHistory(ctx context.Context, request RestoreSourceHistoryRequest) (EntityRevision, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return EntityRevision{}, errors.New("flashcard store is closed")
	}
	if strings.TrimSpace(request.OperationID) == "" || request.SourceID == "" || request.RevisionID == "" ||
		request.ExpectedRevisionID == "" || request.UpdatedAt <= 0 {
		return EntityRevision{}, errors.New("invalid flashcard source restore request")
	}
	restoreRevisionID := DeterministicID("source-history-restore", request.OperationID, request.SourceID, request.RevisionID)
	if batch, exists, queryErr := store.findAppliedOperationLocked(ctx, request.OperationID); queryErr != nil {
		return EntityRevision{}, queryErr
	} else if exists {
		for _, change := range batch.Changes {
			revision := change.Revision
			if revision != nil && revision.EntityType == EntityCardSource && revision.EntityID == request.SourceID &&
				revision.RevisionID == restoreRevisionID && !revision.Deleted && revision.UpdatedAt == request.UpdatedAt &&
				len(revision.ParentRevisionIDs) == 1 && revision.ParentRevisionIDs[0] == request.ExpectedRevisionID {
				return *revision, nil
			}
		}
		return EntityRevision{}, ErrOperationConflict
	}
	version, err := store.projection.SourceHistoryVersion(ctx, request.SourceID, request.RevisionID)
	if err != nil {
		return EntityRevision{}, err
	}
	// 从请求声明的父修订保留管理字段，使重复请求不依赖后来产生的当前版本。
	parent, found, err := store.projection.entityRevisionByID(ctx, request.ExpectedRevisionID)
	if err != nil {
		return EntityRevision{}, err
	}
	if !found || parent.Deleted || parent.EntityType != EntityCardSource || parent.EntityID != request.SourceID {
		return EntityRevision{}, ErrRevisionConflict
	}
	var source, currentSource CardSource
	if err = decodeStrictJSON(version.Revision.Payload, &source); err != nil {
		return EntityRevision{}, err
	}
	if err = decodeStrictJSON(parent.Payload, &currentSource); err != nil {
		return EntityRevision{}, err
	}
	if source.PluginNamespace != "" || source.SchemaID != currentSource.SchemaID {
		return EntityRevision{}, errors.New("unsupported flashcard source history restore")
	}
	source.DefaultPresetID, source.Priority, source.Status = currentSource.DefaultPresetID, currentSource.Priority, currentSource.Status
	restored, err := NewOperationEntityRevision(request.OperationID, EntityCardSource, request.SourceID,
		[]string{request.ExpectedRevisionID}, request.UpdatedAt, false, source)
	if err != nil {
		return EntityRevision{}, err
	}
	restored.RevisionID = restoreRevisionID
	current, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil {
		return EntityRevision{}, err
	}
	if !found || current.RevisionID != request.ExpectedRevisionID {
		return EntityRevision{}, ErrRevisionConflict
	}
	var conflicted bool
	err = store.projection.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM entity_conflicts c WHERE c.resolved = 0 AND (
		(c.entity_type = ? AND c.entity_id = ?) OR (c.entity_type = ? AND c.entity_id = ?) OR
		(c.entity_type = ? AND c.entity_id IN (SELECT entity_id FROM entity_revisions WHERE entity_type = ? AND deleted = 0 AND json_extract(payload, '$.schemaID') = ?)) OR
		(c.entity_type IN (?, ?) AND c.entity_id IN (SELECT id FROM cards WHERE source_id = ?)) OR
		(c.entity_type = ? AND c.entity_id IN (SELECT id FROM card_source_refs WHERE source_id = ?))))`,
		EntityCardSource, source.ID, EntityCardSchema, source.SchemaID, EntityCardTemplate, EntityCardTemplate, source.SchemaID,
		EntityCard, EntityReviewState, source.ID, EntityCardSourceRef, source.ID).Scan(&conflicted)
	if err != nil {
		return EntityRevision{}, err
	}
	if conflicted {
		return EntityRevision{}, ErrRevisionConflict
	}
	if request.ValidateVersion != nil {
		if err = request.ValidateVersion(version); err != nil {
			return EntityRevision{}, err
		}
	}
	mutations, err := store.advancedReferenceMutations(ctx, AdvancedSourceUpdateRequest{
		SourceID: request.SourceID, UpdatedAt: request.UpdatedAt}, version.References)
	if err != nil {
		return EntityRevision{}, err
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &restored}}
	for _, mutation := range mutations {
		var parents []string
		if mutation.ExpectedRevisionID != "" {
			parents = []string{mutation.ExpectedRevisionID}
		}
		revision, revisionErr := NewOperationEntityRevision(request.OperationID, mutation.EntityType, mutation.EntityID,
			parents, request.UpdatedAt, mutation.Deleted, json.RawMessage(mutation.Payload))
		if revisionErr != nil {
			return EntityRevision{}, revisionErr
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	cardChanges, _, err := store.reconcileSourceChanges(ctx, request.OperationID, source, request.UpdatedAt)
	if err != nil {
		return EntityRevision{}, err
	}
	changes = append(changes, cardChanges...)
	for _, change := range changes {
		conflicted, queryErr := store.projection.entityHasUnresolvedConflict(ctx, change.Revision.EntityType, change.Revision.EntityID)
		if queryErr != nil {
			return EntityRevision{}, queryErr
		}
		if conflicted {
			return EntityRevision{}, ErrRevisionConflict
		}
	}
	if err = store.projection.ValidateBusinessChanges(ctx, changes); err != nil {
		return EntityRevision{}, err
	}
	if _, err = store.applyLocked(ctx, request.OperationID, changes); err != nil {
		return EntityRevision{}, err
	}
	return restored, nil
}
