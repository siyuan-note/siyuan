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
	// 属于目标卡源的非墓碑实体修订，payload 为当时的卡源配置。
	Revision EntityRevision `json:"revision"`
	// 沿卡源父修订与操作批次还原，按 Sort、ID 依次升序排列的有效引用。
	References []CardSourceRef `json:"references"`
	// 从该修订的模式及启用模板派生的展示模式，不代表历史卡面渲染结果。
	Modes []string `json:"modes"`
}

// SourceHistory 返回按 UpdatedAt、RevisionID 依次降序排列的卡源修订，包含保留的墓碑。
// sourceID 不能为空白，limit 范围为 1 至 100，offset 不能为负数；没有匹配记录时返回空切片。
// 分页顺序用于浏览，不用于判断引用归属或恢复因果关系；历史记录可随权威批次重建投影。
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
// 修订必须属于指定卡源且不是墓碑；有效引用必须能唯一还原，并包含该修订声明的主引用。
// 引用若曾绕过卡源操作独立修改，缺少配置版本的因果边界时返回错误，不推断历史引用。
// 此处还原引用元数据，不要求正文当前存在；正文可访问性和恢复前校验由调用层处理。
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
	// 必填且不能全为空白；不确定操作结果时连同其他原始字段一起重用，变更请求须使用新的操作 ID。
	OperationID string `json:"operationID"`
	// 必填目标卡源 ID，历史修订与预期当前修订都必须属于该卡源。
	SourceID string `json:"sourceID"`
	// 必填的待恢复历史修订 ID，不能指向墓碑。
	RevisionID string `json:"revisionID"`
	// 必填的当前卡源修订 ID，作为新修订的父修订；过期值返回修订冲突。
	ExpectedRevisionID string `json:"expectedRevisionID"`
	// 必填且大于零的 Unix 毫秒时间；重试时保持首次请求值，不重新生成。
	UpdatedAt int64 `json:"updatedAt"`
	// 仅由内核调用层注入的校验函数，不接受 HTTP 请求传入；校验失败时不应用恢复更改。
	ValidateVersion func(SourceHistoryVersion) error `json:"-"`
}

// RestoreSourceHistory 原子恢复卡源配置、引用及稳定变体，已有复习状态不参与恢复。
// 新修订保留预期当前修订中的 DefaultPresetID、Priority 和 Status，不改写旧修订或复习事件。
// 正文、资源、共享模板、标签与卡包成员不参与回退；恢复配置不改变卡源的软删除或失效状态。
// 相同请求重试返回原恢复修订，复用操作 ID 却改变请求返回操作冲突；不回滚后来产生的状态。
// 过期预期修订、相关实体冲突、插件卡源、不同模式或无法还原的引用均拒绝恢复。
// 校验与协调通过后，配置、引用及卡片更改写入同一权威批次；历史保持可从权威记录重建。
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
