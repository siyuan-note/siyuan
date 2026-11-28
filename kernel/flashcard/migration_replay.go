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
	digest      string
	prepared    Event
	inputs      []LegacyFileFingerprint
	operationID string
}

func legacyPreparation(batch *OperationBatch) (MigrationPreparedPayload, bool, error) {
	var payload MigrationPreparedPayload
	if !strings.HasPrefix(batch.OperationID, "legacy-migration:") || !strings.HasSuffix(batch.OperationID, ":prepare") {
		return payload, false, nil
	}
	last := batch.Changes[len(batch.Changes)-1].Event
	if last == nil || last.EventType != EventMigrationPrepared {
		return payload, false, nil
	}
	if err := decodeStrictJSON(last.Payload, &payload); err != nil {
		return payload, false, err
	}
	return payload, payload.LegacyFormat == legacyFormatVersion && payload.MigrationAlgorithm == "legacy-quick-v1" &&
		batch.OperationID == "legacy-migration:"+payload.MigrationID+":prepare" && last.EntityID == payload.MigrationID &&
		last.EventID == DeterministicID("migration-prepared-event", payload.MigrationID), nil
}

// 早期初次迁移会把设备本地的块索引状态写入同步记录；重放时统一这些记录的可用性。
func replayLegacyPreparation(batch *OperationBatch) (legacyMigrationVariant, legacyMigrationReplay, error) {
	var variant legacyMigrationVariant
	var replay legacyMigrationReplay
	payload, ok, err := legacyPreparation(batch)
	if err != nil || !ok {
		return variant, replay, err
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
	prepared := *batch.Changes[len(batch.Changes)-1].Event
	prepared.Payload, err = CanonicalJSON(payload)
	if err != nil {
		return variant, replay, err
	}
	changes[len(changes)-1].Event = &prepared
	if err = setLegacyReplayChanges(batch, changes); err != nil {
		return variant, replay, err
	}
	return variant, legacyMigrationReplay{digest: digest, prepared: prepared, inputs: payload.InputFiles}, nil
}

type legacyMigrationCollision struct {
	full, incremental []int
}

func findLegacyMigrationCollision(batches []OperationBatch, indexes []int) (legacyMigrationCollision, error) {
	var pair legacyMigrationCollision
	var inputs []LegacyFileFingerprint
	for position, index := range indexes {
		batch := &batches[index]
		payload, ok, err := legacyPreparation(batch)
		if err != nil || !ok {
			return legacyMigrationCollision{}, err
		}
		if position == 0 {
			inputs = payload.InputFiles
		} else if !sameLegacyFingerprints(inputs, payload.InputFiles) {
			return legacyMigrationCollision{}, nil
		}
		var hasParents, hasTemplate, hasPreset bool
		for _, change := range batch.Changes[:len(batch.Changes)-1] {
			if revision := change.Revision; revision != nil {
				if revision.Deleted || len(revision.ParentRevisionIDs) > 1 ||
					revision.RevisionID != OperationRevisionID(batch.OperationID, revision.EntityType, revision.EntityID) {
					return legacyMigrationCollision{}, nil
				}
				hasParents = hasParents || len(revision.ParentRevisionIDs) == 1
				hasTemplate = hasTemplate || revision.EntityType == EntityCardTemplate && revision.EntityID == legacyQuickTemplateID
				hasPreset = hasPreset || revision.EntityType == EntitySchedulerPreset && revision.EntityID == legacyPresetID
			} else if change.Event == nil || change.Event.EventType != EventReview {
				return legacyMigrationCollision{}, nil
			}
		}
		group := &pair.full
		if hasParents {
			group = &pair.incremental
		} else if !hasTemplate || !hasPreset {
			return legacyMigrationCollision{}, nil
		}
		if len(*group) > 0 && batches[(*group)[0]].OperationDigest != batch.OperationDigest {
			return legacyMigrationCollision{}, nil
		}
		if len(*group) == 0 {
			plan := LegacyMigrationPlan{MigrationID: payload.MigrationID, OperationID: batch.OperationID,
				RecordDigest: payload.RecordDigest, Changes: batch.Changes, Report: LegacyMigrationReport{Complete: true}}
			if err = plan.Validate(); err != nil {
				return legacyMigrationCollision{}, err
			}
		}
		*group = append(*group, index)
	}
	return pair, nil
}

// 全量候选中已有的记录由增量端的修订和历史提供，仍被后续操作引用的全量根修订也参与重放。
func replayLegacyMigrationCollisions(batches []OperationBatch, replays map[legacyMigrationVariant]legacyMigrationReplay) error {
	byOperation := map[string][]int{}
	for index, batch := range batches {
		if strings.HasPrefix(batch.OperationID, "legacy-migration:") && strings.HasSuffix(batch.OperationID, ":prepare") {
			byOperation[batch.OperationID] = append(byOperation[batch.OperationID], index)
		}
	}
	var collisions []legacyMigrationCollision
	fullBatches := map[int]bool{}
	for _, indexes := range byOperation {
		if !slices.ContainsFunc(indexes, func(i int) bool {
			return batches[indexes[0]].OperationDigest != batches[i].OperationDigest
		}) {
			continue
		}
		pair, err := findLegacyMigrationCollision(batches, indexes)
		if err != nil {
			return err
		}
		if len(pair.full) == 0 || len(pair.incremental) == 0 {
			continue
		}
		collisions = append(collisions, pair)
		for _, index := range pair.full {
			fullBatches[index] = true
		}
	}
	if len(collisions) == 0 {
		return nil
	}

	type entityKey struct {
		kind EntityType
		id   string
	}
	entities := map[entityKey]bool{}
	revisions, parents, events := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for index, batch := range batches {
		if fullBatches[index] {
			continue
		}
		for _, change := range batch.Changes {
			if revision := change.Revision; revision != nil {
				entities[entityKey{revision.EntityType, revision.EntityID}] = true
				revisions[revision.RevisionID] = true
				for _, parent := range revision.ParentRevisionIDs {
					parents[parent] = true
				}
			} else if change.Event != nil {
				events[change.Event.EventID] = true
			}
		}
	}
	for _, pair := range collisions {
		for _, index := range pair.full {
			batch := &batches[index]
			changes := make([]Change, 0, len(batch.Changes))
			for _, change := range batch.Changes[:len(batch.Changes)-1] {
				if revision := change.Revision; revision != nil {
					if revisions[revision.RevisionID] ||
						entities[entityKey{revision.EntityType, revision.EntityID}] && !parents[revision.RevisionID] {
						continue
					}
				} else if events[change.Event.EventID] {
					continue
				}
				changes = append(changes, change)
			}
			if err := rewriteLegacyPreparation(batch, changes, false, replays); err != nil {
				return err
			}
		}
		for _, index := range pair.incremental {
			batch := &batches[index]
			if err := rewriteLegacyPreparation(batch, slices.Clone(batch.Changes[:len(batch.Changes)-1]), true, replays); err != nil {
				return err
			}
		}
	}
	return nil
}

func rewriteLegacyPreparation(batch *OperationBatch, changes []Change, incremental bool,
	replays map[legacyMigrationVariant]legacyMigrationReplay) error {
	payload, _, err := legacyPreparation(batch)
	if err != nil {
		return err
	}
	original := legacyMigrationVariant{payload.MigrationID, payload.RecordDigest}
	event := *batch.Changes[len(batch.Changes)-1].Event
	if incremental {
		batch.OperationID = "legacy-migration:" + payload.MigrationID + ":rebased:" + payload.RecordDigest + ":prepare"
		event.EventID = DeterministicID("migration-prepared-event", batch.OperationID)
	}
	payload.EntityCount, payload.ReviewEventCount = 0, 0
	for _, change := range changes {
		if change.Revision != nil {
			payload.EntityCount++
		} else {
			payload.ReviewEventCount++
		}
	}
	if payload.RecordDigest, err = checksum(changes); err != nil {
		return err
	}
	if event.Payload, err = CanonicalJSON(payload); err != nil {
		return err
	}
	last := batch.Changes[len(batch.Changes)-1]
	last.Event = &event
	if err = setLegacyReplayChanges(batch, append(changes, last)); err != nil {
		return err
	}
	replay := legacyMigrationReplay{digest: payload.RecordDigest, prepared: event, inputs: payload.InputFiles,
		operationID: batch.OperationID}
	for key, existing := range replays {
		if key.id == original.id && existing.digest == original.digest {
			replays[key] = replay
		}
	}
	replays[original] = replay
	return nil
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
		event.EntityID != payload.MigrationID ||
		payload.PreparedEventID != DeterministicID("migration-prepared-event", payload.MigrationID) ||
		event.OccurredAt != replay.prepared.OccurredAt || !sameLegacyFingerprints(payload.InputFiles, replay.inputs) ||
		event.EventID != DeterministicID("migration-activated-event", payload.MigrationID, payload.RecordDigest) {
		return "", "", nil
	}
	payload.RecordDigest = replay.digest
	payload.PreparedEventID = replay.prepared.EventID
	if replay.operationID != "" {
		batch.OperationID = strings.TrimSuffix(replay.operationID, ":prepare") + ":activate"
	}
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
