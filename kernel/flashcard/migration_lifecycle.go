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
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	MigrationStateLegacy         = "Legacy"
	MigrationStatePreparing      = "Preparing"
	MigrationStateActive         = "Active"
	MigrationStateLegacyDiverged = "LegacyDiverged"
)

// MigrationActivatedPayload 保存经过校验的迁移候选和旧文件水位。
type MigrationActivatedPayload struct {
	MigrationID      string                  `json:"migrationID"`
	PreparedEventID  string                  `json:"preparedEventID"`
	InputFiles       []LegacyFileFingerprint `json:"inputFiles"`
	RecordDigest     string                  `json:"recordDigest"`
	FormatVersion    int                     `json:"formatVersion"`
	MinimumClient    string                  `json:"minimumClient"`
	ValidationMethod string                  `json:"validationMethod"`
}

// LegacyDivergedPayload 保存激活后旧客户端继续写入时的两份文件水位。
type LegacyDivergedPayload struct {
	MigrationID       string                  `json:"migrationID"`
	ActivationEventID string                  `json:"activationEventID"`
	ActivatedInputs   []LegacyFileFingerprint `json:"activatedInputs"`
	CurrentInputs     []LegacyFileFingerprint `json:"currentInputs"`
}

// LegacyMigrationStatus 返回当前切换状态和对应不可变事件。
type LegacyMigrationStatus struct {
	State       string `json:"state"`
	MigrationID string `json:"migrationID,omitempty"`
	Prepared    *Event `json:"prepared,omitempty"`
	Activated   *Event `json:"activated,omitempty"`
	Diverged    *Event `json:"diverged,omitempty"`
}

// LegacyActivationResult 返回候选写入和最终激活两个独立、可重试的批次。
type LegacyActivationResult struct {
	PreparedBatch   OperationBatch        `json:"preparedBatch"`
	ActivationBatch OperationBatch        `json:"activationBatch"`
	Status          LegacyMigrationStatus `json:"status"`
}

// ActivateLegacyMigration 在输入未变化且候选投影校验通过后写入不可变激活事件。
func (store *Store) ActivateLegacyMigration(ctx context.Context, legacyRoot string,
	plan LegacyMigrationPlan) (LegacyActivationResult, error) {
	if err := plan.Validate(); err != nil {
		return LegacyActivationResult{}, err
	}
	if err := VerifyLegacyMigrationInputs(legacyRoot, plan.InputFiles); err != nil {
		return LegacyActivationResult{}, err
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err != nil {
		return LegacyActivationResult{}, err
	}
	if status.State == MigrationStateActive && status.MigrationID != plan.MigrationID {
		return LegacyActivationResult{}, errors.New("another flashcard migration is already active")
	}
	if status.State == MigrationStateLegacyDiverged {
		plan, err = store.rebaseDivergedLegacyMigration(ctx, plan, status)
		if err != nil {
			return LegacyActivationResult{}, err
		}
		if err = plan.Validate(); err != nil {
			return LegacyActivationResult{}, err
		}
	}
	if err = store.projection.ValidateBusinessChanges(ctx, plan.Changes); err != nil {
		return LegacyActivationResult{}, fmt.Errorf("validate migrated flashcard references: %w", err)
	}
	preparedBatch, err := store.Apply(ctx, plan.OperationID, plan.Changes)
	if err != nil {
		return LegacyActivationResult{}, err
	}
	if err = store.projection.QuickCheck(ctx); err != nil {
		return LegacyActivationResult{}, fmt.Errorf("validate migrated flashcard projection: %w", err)
	}
	prepared := plan.Changes[len(plan.Changes)-1].Event
	payload := MigrationActivatedPayload{
		MigrationID: plan.MigrationID, PreparedEventID: prepared.EventID,
		InputFiles: append([]LegacyFileFingerprint(nil), plan.InputFiles...), RecordDigest: plan.RecordDigest,
		FormatVersion: FormatVersion, MinimumClient: DefaultManifest().MinimumClient,
		ValidationMethod: "authority-digest+sqlite-quick-check-v1",
	}
	payloadJSON, err := CanonicalJSON(payload)
	if err != nil {
		return LegacyActivationResult{}, err
	}
	activation := Event{
		EventType: EventMigrationActivated,
		EventID:   DeterministicID("migration-activated-event", plan.MigrationID, plan.RecordDigest),
		EntityID:  plan.MigrationID, OccurredAt: prepared.OccurredAt, Payload: payloadJSON,
	}
	if err = activation.Validate(); err != nil {
		return LegacyActivationResult{}, err
	}
	operationID := "legacy-migration:" + plan.MigrationID + ":activate"
	activationBatch, err := store.Apply(ctx, operationID, []Change{{Kind: RecordEvent, Event: &activation}})
	if err != nil {
		return LegacyActivationResult{}, err
	}
	status, err = store.LegacyMigrationStatus(ctx)
	if err != nil {
		return LegacyActivationResult{}, err
	}
	return LegacyActivationResult{PreparedBatch: preparedBatch, ActivationBatch: activationBatch, Status: status}, nil
}

// rebaseDivergedLegacyMigration 将旧存储全量候选衔接到当前实体，避免把增量重新写成并发根修订。
func (store *Store) rebaseDivergedLegacyMigration(ctx context.Context, plan LegacyMigrationPlan,
	status LegacyMigrationStatus) (LegacyMigrationPlan, error) {
	preparedIndex := len(plan.Changes) - 1
	changes := make([]Change, 0, len(plan.Changes))
	entityCount := 0
	reviewEventCount := 0
	for index := 0; index < preparedIndex; index++ {
		change := plan.Changes[index]
		switch change.Kind {
		case RecordEntityRevision:
			current, found, err := store.projection.CurrentEntity(ctx, change.Revision.EntityType,
				change.Revision.EntityID)
			if err != nil {
				return LegacyMigrationPlan{}, err
			}
			if found {
				apply, mergeErr := mergeDivergedLegacyRevision(change.Revision, current)
				if mergeErr != nil {
					return LegacyMigrationPlan{}, mergeErr
				}
				if !apply {
					continue
				}
				change.Revision.ParentRevisionIDs = []string{current.RevisionID}
			}
			changes = append(changes, change)
			entityCount++
		case RecordEvent:
			exists, err := store.projection.eventExists(ctx, change.Event.EventID)
			if err != nil {
				return LegacyMigrationPlan{}, err
			}
			if exists {
				continue
			}
			changes = append(changes, change)
			reviewEventCount++
		default:
			return LegacyMigrationPlan{}, fmt.Errorf("unsupported incremental legacy migration record [%s]", change.Kind)
		}
	}
	digest, err := checksum(changes)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	prepared := *plan.Changes[preparedIndex].Event
	var payload MigrationPreparedPayload
	if err = decodeStrictJSON(prepared.Payload, &payload); err != nil {
		return LegacyMigrationPlan{}, err
	}
	payload.RecordDigest = digest
	payload.EntityCount = entityCount
	payload.ReviewEventCount = reviewEventCount
	prepared.Payload, err = CanonicalJSON(payload)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	minimumOccurredAt := int64(0)
	for _, event := range []*Event{status.Prepared, status.Activated, status.Diverged} {
		if event != nil && event.OccurredAt >= minimumOccurredAt {
			minimumOccurredAt = event.OccurredAt + 1
		}
	}
	if prepared.OccurredAt < minimumOccurredAt {
		prepared.OccurredAt = minimumOccurredAt
	}
	changes = append(changes, Change{Kind: RecordEvent, Event: &prepared})
	plan.Changes = changes
	plan.RecordDigest = digest
	return plan, nil
}

func mergeDivergedLegacyRevision(incoming *EntityRevision, current EntityRevision) (bool, error) {
	if incoming.Deleted == current.Deleted && bytes.Equal(incoming.Payload, current.Payload) {
		return false, nil
	}
	if current.UpdatedAt > incoming.UpdatedAt || current.UpdatedAt == incoming.UpdatedAt && current.Deleted {
		return false, nil
	}
	switch incoming.EntityType {
	case EntityReviewState:
		var incomingState, currentState ReviewState
		if err := decodeStrictJSON(incoming.Payload, &incomingState); err != nil {
			return false, err
		}
		if err := decodeStrictJSON(current.Payload, &currentState); err != nil {
			return false, err
		}
		if currentState.LastReview >= incomingState.LastReview {
			return false, nil
		}
	case EntityCard:
		var incomingCard, currentCard Card
		if err := decodeStrictJSON(incoming.Payload, &incomingCard); err != nil {
			return false, err
		}
		if err := decodeStrictJSON(current.Payload, &currentCard); err != nil {
			return false, err
		}
		incomingCard.Flag = currentCard.Flag
		incomingCard.PresetOverrideID = currentCard.PresetOverrideID
		incomingCard.PriorityOverride = currentCard.PriorityOverride
		incomingCard.CreatedAt = currentCard.CreatedAt
		var err error
		incoming.Payload, err = CanonicalJSON(incomingCard)
		if err != nil {
			return false, err
		}
	}
	return true, nil
}

// LegacyMigrationStatus 从不可变领域事件计算当前迁移状态。
func (store *Store) LegacyMigrationStatus(ctx context.Context) (LegacyMigrationStatus, error) {
	events, err := store.projection.DomainEvents(ctx, EventMigrationPrepared, EventMigrationActivated,
		EventLegacyDiverged)
	if err != nil {
		return LegacyMigrationStatus{}, err
	}
	status := LegacyMigrationStatus{State: MigrationStateLegacy}
	divergences := make(map[string]Event)
	for index := range events {
		event := events[index]
		switch event.EventType {
		case EventMigrationPrepared:
			copied := event
			status.Prepared = &copied
		case EventMigrationActivated:
			copied := event
			status.Activated = &copied
		case EventLegacyDiverged:
			var payload LegacyDivergedPayload
			if err = decodeStrictJSON(event.Payload, &payload); err != nil {
				return LegacyMigrationStatus{}, fmt.Errorf("decode flashcard legacy divergence: %w", err)
			}
			divergences[payload.ActivationEventID] = event
		}
	}
	if status.Activated != nil {
		var payload MigrationActivatedPayload
		if err = decodeStrictJSON(status.Activated.Payload, &payload); err != nil {
			return LegacyMigrationStatus{}, fmt.Errorf("decode flashcard migration activation: %w", err)
		}
		status.MigrationID = payload.MigrationID
		status.State = MigrationStateActive
		if event, found := divergences[status.Activated.EventID]; found {
			copied := event
			status.Diverged = &copied
			status.State = MigrationStateLegacyDiverged
		}
	} else if status.Prepared != nil {
		status.MigrationID = status.Prepared.EntityID
		status.State = MigrationStatePreparing
	}
	return status, nil
}

// CheckLegacyDivergence 检测激活水位后的旧格式写入，并仅写入一次确定性告警事件。
func (store *Store) CheckLegacyDivergence(ctx context.Context, legacyRoot string) (LegacyMigrationStatus, error) {
	status, err := store.LegacyMigrationStatus(ctx)
	if err != nil || status.Activated == nil || status.State == MigrationStateLegacyDiverged {
		return status, err
	}
	var activation MigrationActivatedPayload
	if err = decodeStrictJSON(status.Activated.Payload, &activation); err != nil {
		return LegacyMigrationStatus{}, err
	}
	current, err := LegacyInputFingerprints(legacyRoot)
	if err != nil {
		return LegacyMigrationStatus{}, err
	}
	if sameLegacyFingerprints(activation.InputFiles, current) {
		return status, nil
	}
	payload := LegacyDivergedPayload{
		MigrationID: activation.MigrationID, ActivationEventID: status.Activated.EventID,
		ActivatedInputs: append([]LegacyFileFingerprint(nil), activation.InputFiles...), CurrentInputs: current,
	}
	payloadJSON, err := CanonicalJSON(payload)
	if err != nil {
		return LegacyMigrationStatus{}, err
	}
	digest, err := checksum(current)
	if err != nil {
		return LegacyMigrationStatus{}, err
	}
	event := Event{
		EventType: EventLegacyDiverged,
		EventID:   DeterministicID("legacy-diverged-event", status.Activated.EventID, digest),
		EntityID:  activation.MigrationID, OccurredAt: status.Activated.OccurredAt + 1, Payload: payloadJSON,
	}
	if err = event.Validate(); err != nil {
		return LegacyMigrationStatus{}, err
	}
	operationID := "legacy-divergence:" + event.EventID
	if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEvent, Event: &event}}); err != nil {
		return LegacyMigrationStatus{}, err
	}
	return store.LegacyMigrationStatus(ctx)
}

// VerifyLegacyMigrationInputs 确保预览与激活之间没有旧文件增删或内容变化。
func VerifyLegacyMigrationInputs(root string, expected []LegacyFileFingerprint) error {
	current, err := LegacyInputFingerprints(root)
	if err != nil {
		return err
	}
	if !sameLegacyFingerprints(expected, current) {
		return errors.New("legacy flashcard data changed after migration preview")
	}
	return nil
}

// LegacyInputFingerprints 读取全部旧版卡包、卡片和复习日志的内容身份。
func LegacyInputFingerprints(root string) ([]LegacyFileFingerprint, error) {
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return []LegacyFileFingerprint{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("inspect legacy flashcard root: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return nil, errors.New("legacy flashcard root is not a regular directory")
	}
	paths := make([]string, 0)
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read legacy flashcard root: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".deck") || strings.HasSuffix(entry.Name(), ".cards") {
			paths = append(paths, entry.Name())
		}
	}
	logsRoot := filepath.Join(root, "logs")
	if entries, readErr := os.ReadDir(logsRoot); readErr == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".msgpack") {
				paths = append(paths, filepath.Join("logs", entry.Name()))
			}
		}
	} else if !os.IsNotExist(readErr) {
		return nil, fmt.Errorf("read legacy flashcard logs: %w", readErr)
	}
	sort.Strings(paths)
	ret := make([]LegacyFileFingerprint, 0, len(paths))
	for _, relativePath := range paths {
		file, readErr := readLegacyFile(root, relativePath)
		if readErr != nil {
			return nil, readErr
		}
		ret = append(ret, file.fingerprint)
	}
	return ret, nil
}

func sameLegacyFingerprints(first, second []LegacyFileFingerprint) bool {
	if len(first) != len(second) {
		return false
	}
	left := append([]LegacyFileFingerprint(nil), first...)
	right := append([]LegacyFileFingerprint(nil), second...)
	sort.Slice(left, func(i, j int) bool { return left[i].Path < left[j].Path })
	sort.Slice(right, func(i, j int) bool { return right[i].Path < right[j].Path })
	for index := range left {
		if left[index].Path != right[index].Path || left[index].Size != right[index].Size ||
			left[index].SHA256 != right[index].SHA256 {
			return false
		}
	}
	return true
}
