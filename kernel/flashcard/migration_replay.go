// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"fmt"
	"slices"
	"strings"
)

type legacyMigrationVariant struct {
	id     string
	digest string
}

type legacyMigrationReplay struct {
	digest   string
	prepared Event
	inputs   []LegacyFileFingerprint
}

// 早期初次迁移会把设备本地的块索引状态写入同步记录；重放时统一这些记录的可用性。
func replayLegacyPreparation(batch *OperationBatch) (legacyMigrationVariant, legacyMigrationReplay, error) {
	var variant legacyMigrationVariant
	var replay legacyMigrationReplay
	if !strings.HasPrefix(batch.OperationID, "legacy-migration:") || !strings.HasSuffix(batch.OperationID, ":prepare") {
		return variant, replay, nil
	}
	last := batch.Changes[len(batch.Changes)-1].Event
	if last == nil || last.EventType != EventMigrationPrepared {
		return variant, replay, nil
	}
	var payload MigrationPreparedPayload
	if err := decodeStrictJSON(last.Payload, &payload); err != nil {
		return variant, replay, err
	}
	if payload.LegacyFormat != legacyFormatVersion || payload.MigrationAlgorithm != "legacy-quick-v1" ||
		batch.OperationID != "legacy-migration:"+payload.MigrationID+":prepare" || last.EntityID != payload.MigrationID ||
		last.EventID != DeterministicID("migration-prepared-event", payload.MigrationID) {
		return variant, replay, nil
	}

	original := batch.Changes[:len(batch.Changes)-1]
	changes := slices.Clone(batch.Changes)
	changed := false
	for index, change := range original {
		revision := change.Revision
		if revision == nil {
			continue
		}
		if len(revision.ParentRevisionIDs) > 0 || revision.Deleted ||
			revision.RevisionID != OperationRevisionID(batch.OperationID, revision.EntityType, revision.EntityID) {
			return variant, replay, nil
		}
		var value any
		switch revision.EntityType {
		case EntityCardSource:
			var source CardSource
			if err := decodeStrictJSON(revision.Payload, &source); err != nil {
				return variant, replay, err
			}
			if source.SchemaID == legacyQuickSchemaID && source.SourceType == "block" && source.Status == "orphaned" {
				source.Status = "active"
				value = source
			}
		case EntityCard:
			var card Card
			if err := decodeStrictJSON(revision.Payload, &card); err != nil {
				return variant, replay, err
			}
			if card.TemplateID == legacyQuickTemplateID && card.VariantKey == "legacy-quick" &&
				card.GenerationStatus == GenerationOrphaned {
				card.GenerationStatus = GenerationActive
				value = card
			}
		}
		if value != nil {
			rewritten := *revision
			var err error
			rewritten.Payload, err = CanonicalJSON(value)
			if err != nil {
				return variant, replay, err
			}
			changes[index].Revision = &rewritten
			changed = true
		}
	}
	if !changed {
		return variant, replay, nil
	}

	plan := LegacyMigrationPlan{MigrationID: payload.MigrationID, OperationID: batch.OperationID,
		RecordDigest: payload.RecordDigest, Changes: batch.Changes, Report: LegacyMigrationReport{Complete: true}}
	if err := plan.Validate(); err != nil {
		return variant, replay, err
	}
	variant = legacyMigrationVariant{payload.MigrationID, payload.RecordDigest}
	digest, err := checksum(changes[:len(changes)-1])
	if err != nil {
		return variant, replay, err
	}
	payload.RecordDigest = digest
	prepared := *last
	prepared.Payload, err = CanonicalJSON(payload)
	if err != nil {
		return variant, replay, err
	}
	changes[len(changes)-1].Event = &prepared
	if err = setLegacyReplayChanges(batch, changes); err != nil {
		return variant, replay, err
	}
	return variant, legacyMigrationReplay{digest, prepared, payload.InputFiles}, nil
}

func replayLegacyActivation(batch *OperationBatch, variants map[legacyMigrationVariant]legacyMigrationReplay) (string, string, error) {
	if len(variants) == 0 || len(batch.Changes) != 1 ||
		!strings.HasPrefix(batch.OperationID, "legacy-migration:") || !strings.HasSuffix(batch.OperationID, ":activate") {
		return "", "", nil
	}
	event := batch.Changes[0].Event
	if event == nil || event.EventType != EventMigrationActivated {
		return "", "", nil
	}
	var payload MigrationActivatedPayload
	if err := decodeStrictJSON(event.Payload, &payload); err != nil {
		return "", "", err
	}
	replay, found := variants[legacyMigrationVariant{payload.MigrationID, payload.RecordDigest}]
	if !found || batch.OperationID != "legacy-migration:"+payload.MigrationID+":activate" ||
		event.EntityID != payload.MigrationID || payload.PreparedEventID != replay.prepared.EventID ||
		event.OccurredAt != replay.prepared.OccurredAt || !sameLegacyFingerprints(payload.InputFiles, replay.inputs) ||
		event.EventID != DeterministicID("migration-activated-event", payload.MigrationID, payload.RecordDigest) {
		return "", "", nil
	}
	payload.RecordDigest = replay.digest
	activation := *event
	activation.EventID = DeterministicID("migration-activated-event", payload.MigrationID, payload.RecordDigest)
	var err error
	activation.Payload, err = CanonicalJSON(payload)
	if err != nil {
		return "", "", err
	}
	change := batch.Changes[0]
	change.Event = &activation
	if err = setLegacyReplayChanges(batch, []Change{change}); err != nil {
		return "", "", err
	}
	return event.EventID, activation.EventID, nil
}

func setLegacyReplayChanges(batch *OperationBatch, changes []Change) error {
	batch.Changes = changes
	digest, err := checksum(changes)
	if err != nil {
		return fmt.Errorf("checksum legacy flashcard replay changes: %w", err)
	}
	batch.OperationDigest = digest
	return sealBatch(batch)
}
