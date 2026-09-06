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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// resolveSourcePreset 在首次制卡时固化显式或最近范围预设，恢复卡源时沿用已保存的预设。
func (store *Store) resolveSourcePreset(ctx context.Context, operationID, sourceID, explicitPresetID, blockID string,
	metadata []BlockMetadata) (string, error) {
	if explicitPresetID != strings.TrimSpace(explicitPresetID) {
		return "", errors.New("flashcard source scheduler preset is invalid")
	}
	if explicitPresetID == "" {
		batch, found, err := store.findAppliedOperation(ctx, operationID)
		if err != nil {
			return "", err
		}
		if found {
			for _, change := range batch.Changes {
				if revision := change.Revision; revision != nil && revision.EntityType == EntityCardSource &&
					revision.EntityID == sourceID && !revision.Deleted {
					var source CardSource
					if err = decodeStrictJSON(revision.Payload, &source); err != nil {
						return "", err
					}
					return source.DefaultPresetID, nil
				}
			}
		}
	}
	if revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID); err != nil {
		return "", err
	} else if found && !revision.Deleted {
		var source CardSource
		if err = decodeStrictJSON(revision.Payload, &source); err != nil {
			return "", err
		}
		if explicitPresetID == "" {
			return source.DefaultPresetID, nil
		}
	}
	if explicitPresetID != "" {
		return explicitPresetID, nil
	}
	var location BlockMetadata
	for _, item := range metadata {
		if item.BlockID == blockID {
			location = item
			break
		}
	}
	if location.BlockID == "" {
		err := store.projection.db.QueryRowContext(ctx, `SELECT block_id, notebook_id, root_id, path
			FROM block_metadata WHERE block_id = ?`, blockID).Scan(&location.BlockID, &location.NotebookID,
			&location.RootID, &location.Path)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("query flashcard source preset location: %w", err)
		}
	}
	if location.BlockID == "" {
		return legacyPresetID, nil
	}
	scopes := [][2]string{{"document", location.RootID}}
	ancestors := strings.Split(strings.Trim(location.Path, "/"), "/")
	for index := len(ancestors) - 2; index >= 0; index-- {
		if ancestors[index] != location.RootID {
			scopes = append(scopes, [2]string{"document", ancestors[index]})
		}
	}
	scopes = append(scopes, [2]string{"notebook", location.NotebookID})
	for _, scope := range scopes {
		revision, found, err := store.projection.StudyPolicyRevision(ctx, scope[0], scope[1])
		if err != nil {
			return "", err
		}
		if !found || revision.Deleted {
			continue
		}
		conflicted, err := store.projection.entityHasUnresolvedConflict(ctx, EntityStudyPolicy, revision.EntityID)
		if err != nil {
			return "", err
		}
		if conflicted {
			return "", fmt.Errorf("%w: study policy [%s:%s]", ErrRevisionConflict, scope[0], scope[1])
		}
		var policy StudyPolicy
		if err = decodeStrictJSON(revision.Payload, &policy); err != nil {
			return "", err
		}
		if policy.DefaultPresetID != "" {
			return policy.DefaultPresetID, nil
		}
	}
	return legacyPresetID, nil
}
