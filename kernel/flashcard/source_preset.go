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

type sourcePresetSelection struct {
	legacyID   string
	overrideID string
}

func (store *Store) sourcePresetForCreation(ctx context.Context, operationID, sourceID, explicitPresetID string) (sourcePresetSelection, error) {
	if explicitPresetID != strings.TrimSpace(explicitPresetID) {
		return sourcePresetSelection{}, errors.New("flashcard source scheduler preset is invalid")
	}
	batch, found, err := store.findAppliedOperation(ctx, operationID)
	if err != nil {
		return sourcePresetSelection{}, err
	}
	if found {
		for _, change := range batch.Changes {
			if revision := change.Revision; revision != nil && revision.EntityType == EntityCardSource &&
				revision.EntityID == sourceID && !revision.Deleted {
				var source CardSource
				if err = decodeStrictJSON(revision.Payload, &source); err != nil {
					return sourcePresetSelection{}, err
				}
				if explicitPresetID != "" && explicitPresetID != source.PresetOverrideID &&
					(source.PresetOverrideID != "" || explicitPresetID != source.DefaultPresetID) {
					return sourcePresetSelection{}, ErrOperationConflict
				}
				return sourcePresetSelection{source.DefaultPresetID, source.PresetOverrideID}, nil
			}
		}
	}
	return sourcePresetSelection{overrideID: explicitPresetID}, nil
}

// 排期读取与筛选共用当前主引用块的位置，不改写卡源修订和复习状态。
var sourcePresetSQL = fmt.Sprintf(`COALESCE(NULLIF((SELECT json_extract(entity.payload, '$.presetOverrideID')
        FROM entities entity WHERE entity.entity_type = 'cardSource' AND entity.entity_id = s.id AND entity.deleted = 0), ''),
    CASE WHEN s.schema_id NOT IN ('%s', '%s', '%s', '%s', '%s', '%s', '%s') OR s.source_type = 'legacy-history'
        THEN s.default_preset_id
        ELSE COALESCE((SELECT COALESCE(
            (SELECT NULLIF(policy.default_preset_id, '') FROM study_policies policy
                WHERE policy.scope_type = 'document' AND policy.scope_id = metadata.root_id),
            (WITH RECURSIVE ancestors(depth, id, rest) AS (
                SELECT 0, '', substr(metadata.path, 2)
                UNION ALL SELECT depth + 1, substr(rest, 1, instr(rest, '/') - 1), substr(rest, instr(rest, '/') + 1)
                FROM ancestors WHERE instr(rest, '/') > 0
            ) SELECT policy.default_preset_id FROM ancestors
                JOIN study_policies policy ON policy.scope_type = 'document' AND policy.scope_id = ancestors.id
                WHERE ancestors.depth > 0 AND policy.default_preset_id <> '' ORDER BY ancestors.depth DESC LIMIT 1),
            (SELECT NULLIF(policy.default_preset_id, '') FROM study_policies policy
                WHERE policy.scope_type = 'notebook' AND policy.scope_id = metadata.notebook_id))
            FROM card_source_refs primary_ref JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
            WHERE primary_ref.id = s.primary_ref_id AND primary_ref.source_id = s.id AND primary_ref.entity_type = 'block'), '%s')
    END)`,
	legacyQuickSchemaID, basicSchemaID, advancedSchemaID, advancedImageSchemaID, advancedChoiceSchemaID, advancedMultiLineSchemaID, advancedTypedSchemaID,
	legacyPresetID)

var effectivePresetSQL = `COALESCE(NULLIF(c.preset_override_id, ''), ` + sourcePresetSQL + `)`

func (projection *Projection) sourcePresetID(ctx context.Context, sourceID string) (string, error) {
	var id string
	err := projection.db.QueryRowContext(ctx, `SELECT `+sourcePresetSQL+` FROM card_sources s WHERE s.id = ?`, sourceID).Scan(&id)
	return id, err
}
