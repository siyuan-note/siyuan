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
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/riff"
	"github.com/vmihailenco/msgpack/v5"
)

const legacyFormatVersion = 1

var (
	// ErrNoLegacyFlashcards 表示旧存储中没有可迁移的卡包。
	ErrNoLegacyFlashcards = errors.New("legacy flashcard data was not found")

	legacyQuickSchemaID   = DeterministicID("builtin", "legacy-quick-schema")
	legacyQuickTemplateID = DeterministicID("builtin", "legacy-quick-template")
	legacyQuickFieldID    = DeterministicID("builtin", "legacy-quick-content-field")
	legacyPresetID        = DeterministicID("builtin", "legacy-default-preset")
)

// LegacyBlockInfo 是迁移器判断普通、缺失和加密内容所需的最小块信息。
type LegacyBlockInfo struct {
	Exists    bool
	Encrypted bool
}

// LegacyBlockResolver 在不复制块正文的情况下执行内容存在性和加密边界检查。
type LegacyBlockResolver func(ctx context.Context, blockID string) (LegacyBlockInfo, error)

// LegacyMigrationOptions 保存从全局旧设置生成默认排期预设所需的确定性参数。
type LegacyMigrationOptions struct {
	RequestRetention   float64
	MaximumInterval    int
	Weights            []float64
	NewLimit           int
	ReviewLimit        int
	BuryNewSiblings    bool
	BuryReviewSiblings bool
	LeechThreshold     int
	LeechAction        string
	PresetName         string
	EmptyDeckID        string
	EmptyDeckName      string
	ResolveBlock       LegacyBlockResolver `json:"-"`
}

// LegacyFileFingerprint 保存激活水位所需的旧文件内容身份。
type LegacyFileFingerprint struct {
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
	ModifiedAt int64  `json:"-"`
}

// LegacyMigrationReport 是只保存在本机预览中的迁移统计和隔离结果。
type LegacyMigrationReport struct {
	Complete              bool
	LegacyDecks           int
	LegacyCards           int
	MigratedSources       int
	MigratedCards         int
	ArchivedCards         int
	MergedCards           int
	ReviewSets            int
	ReviewEvents          int
	OrphanedSources       int
	SkippedEncryptedCards int
	SkippedEncryptedLogs  int
	InvalidCards          int
	UnmappedLogs          int
}

// LegacyMigrationPlan 是确定性实体、事件和本机预览报告。
type LegacyMigrationPlan struct {
	MigrationID  string
	OperationID  string
	InputFiles   []LegacyFileFingerprint
	RecordDigest string
	Changes      []Change
	Report       LegacyMigrationReport
}

// MigrationPreparedPayload 保存可同步的迁移输入水位和候选记录摘要。
type MigrationPreparedPayload struct {
	MigrationID        string                  `json:"migrationID"`
	LegacyFormat       int                     `json:"legacyFormat"`
	InputFiles         []LegacyFileFingerprint `json:"inputFiles"`
	RecordDigest       string                  `json:"recordDigest"`
	EntityCount        int                     `json:"entityCount"`
	ReviewEventCount   int                     `json:"reviewEventCount"`
	MinimumClient      string                  `json:"minimumClient"`
	MigrationAlgorithm string                  `json:"migrationAlgorithm"`
}

type legacyDeckInput struct {
	id        string
	metadata  riff.Deck
	cards     map[string]*riff.FSRSCard
	deckFile  legacyFileInput
	cardsFile *legacyFileInput
}

type legacyLogInput struct {
	file legacyFileInput
	logs []*riff.Log
}

type legacyFileInput struct {
	fingerprint LegacyFileFingerprint
	data        []byte
}

type legacyCardRecord struct {
	deckID    string
	cardID    string
	blockID   string
	card      *fsrs.Card
	createdAt int64
	updatedAt int64
}

type plannedEntity struct {
	entityType EntityType
	entityID   string
	updatedAt  int64
	payload    any
}

// PrepareLegacyMigration 只读取旧数据并生成确定性候选，不修改旧文件或 v2 存储。
func PrepareLegacyMigration(ctx context.Context, legacyRoot string,
	options LegacyMigrationOptions) (LegacyMigrationPlan, error) {
	if err := options.validate(); err != nil {
		return LegacyMigrationPlan{}, err
	}
	decks, logs, fingerprints, err := readLegacyInputs(legacyRoot)
	legacyDeckCount := len(decks)
	if errors.Is(err, ErrNoLegacyFlashcards) && options.EmptyDeckID != "" {
		decks = []legacyDeckInput{{id: options.EmptyDeckID, metadata: riff.Deck{
			ID: options.EmptyDeckID, Name: options.EmptyDeckName,
		}, cards: map[string]*riff.FSRSCard{}}}
		logs = []legacyLogInput{}
		fingerprints = []LegacyFileFingerprint{}
		err = nil
	}
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	migrationID, err := legacyMigrationID(fingerprints, options)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	operationID := "legacy-migration:" + migrationID + ":prepare"
	plan := LegacyMigrationPlan{
		MigrationID: migrationID,
		OperationID: operationID,
		InputFiles:  fingerprints,
		Report: LegacyMigrationReport{
			Complete:    true,
			LegacyDecks: legacyDeckCount,
		},
	}
	entities, reviewEvents, logicalTime, err := buildLegacyRecords(ctx, decks, logs, options, &plan.Report,
		operationID)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	sort.Slice(entities, func(i, j int) bool {
		if entities[i].entityType != entities[j].entityType {
			return entities[i].entityType < entities[j].entityType
		}
		return entities[i].entityID < entities[j].entityID
	})
	for _, entity := range entities {
		revision, revisionErr := NewOperationEntityRevision(operationID, entity.entityType, entity.entityID, nil,
			entity.updatedAt, false, entity.payload)
		if revisionErr != nil {
			return LegacyMigrationPlan{}, revisionErr
		}
		plan.Changes = append(plan.Changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	sort.Slice(reviewEvents, func(i, j int) bool {
		if reviewEvents[i].OccurredAt != reviewEvents[j].OccurredAt {
			return reviewEvents[i].OccurredAt < reviewEvents[j].OccurredAt
		}
		return reviewEvents[i].EventID < reviewEvents[j].EventID
	})
	for index := range reviewEvents {
		event := reviewEvents[index]
		plan.Changes = append(plan.Changes, Change{Kind: RecordEvent, Event: &event})
	}
	plan.RecordDigest, err = checksum(plan.Changes)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	preparedPayload := MigrationPreparedPayload{
		MigrationID:        migrationID,
		LegacyFormat:       legacyFormatVersion,
		InputFiles:         fingerprints,
		RecordDigest:       plan.RecordDigest,
		EntityCount:        len(entities),
		ReviewEventCount:   len(reviewEvents),
		MinimumClient:      DefaultManifest().MinimumClient,
		MigrationAlgorithm: "legacy-quick-v1",
	}
	payload, err := CanonicalJSON(preparedPayload)
	if err != nil {
		return LegacyMigrationPlan{}, err
	}
	preparedEvent := Event{
		EventType:  EventMigrationPrepared,
		EventID:    DeterministicID("migration-prepared-event", migrationID),
		EntityID:   migrationID,
		OccurredAt: logicalTime,
		Payload:    payload,
	}
	if err = preparedEvent.Validate(); err != nil {
		return LegacyMigrationPlan{}, err
	}
	plan.Changes = append(plan.Changes, Change{Kind: RecordEvent, Event: &preparedEvent})
	return plan, nil
}

// Validate 重新计算候选摘要并验证全部权威记录。
func (plan *LegacyMigrationPlan) Validate() error {
	if plan == nil || strings.TrimSpace(plan.MigrationID) == "" || strings.TrimSpace(plan.OperationID) == "" {
		return errors.New("legacy migration plan identity is incomplete")
	}
	if !plan.Report.Complete {
		return errors.New("legacy migration plan has unresolved records")
	}
	if len(plan.Changes) < 1 {
		return errors.New("legacy migration plan has no records")
	}
	prepared := plan.Changes[len(plan.Changes)-1]
	if prepared.Kind != RecordEvent || prepared.Event == nil || prepared.Event.EventType != EventMigrationPrepared {
		return errors.New("legacy migration plan lacks its prepared event")
	}
	normalized, err := normalizeChanges(plan.Changes[:len(plan.Changes)-1])
	if err != nil {
		return err
	}
	digest, err := checksum(normalized)
	if err != nil {
		return err
	}
	if digest != plan.RecordDigest {
		return errors.New("legacy migration plan record digest changed")
	}
	if err = prepared.Validate(); err != nil {
		return err
	}
	var payload MigrationPreparedPayload
	if err = decodeStrictJSON(prepared.Event.Payload, &payload); err != nil {
		return err
	}
	if payload.MigrationID != plan.MigrationID || payload.RecordDigest != plan.RecordDigest ||
		payload.EntityCount+payload.ReviewEventCount != len(plan.Changes)-1 {
		return errors.New("legacy migration prepared event does not match its records")
	}
	return nil
}

func (options *LegacyMigrationOptions) validate() error {
	if options.ResolveBlock == nil {
		return errors.New("legacy migration block resolver is required")
	}
	if (options.EmptyDeckID == "") != (options.EmptyDeckName == "") {
		return errors.New("empty-workspace legacy deck identity and name must be specified together")
	}
	preset := SchedulerPreset{
		ID:                 legacyPresetID,
		Name:               options.PresetName,
		SchedulerVersion:   SchedulerVersionFSRS6,
		RequestRetention:   options.RequestRetention,
		MaximumInterval:    options.MaximumInterval,
		Weights:            options.Weights,
		NewLimit:           options.NewLimit,
		ReviewLimit:        options.ReviewLimit,
		BuryNewSiblings:    options.BuryNewSiblings,
		BuryReviewSiblings: options.BuryReviewSiblings,
		LeechThreshold:     options.LeechThreshold,
		LeechAction:        options.LeechAction,
	}
	return preset.validate(legacyPresetID)
}

func readLegacyInputs(root string) ([]legacyDeckInput, []legacyLogInput, []LegacyFileFingerprint, error) {
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return nil, nil, nil, ErrNoLegacyFlashcards
	}
	if err != nil {
		return nil, nil, nil, fmt.Errorf("inspect legacy flashcard root: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return nil, nil, nil, errors.New("legacy flashcard root is not a regular directory")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read legacy flashcard root: %w", err)
	}
	var decks []legacyDeckInput
	var fingerprints []LegacyFileFingerprint
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".deck") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil, nil, nil, errors.New("legacy flashcard deck is a symbolic link")
		}
		deckID := strings.TrimSuffix(entry.Name(), ".deck")
		if strings.TrimSpace(deckID) == "" {
			return nil, nil, nil, errors.New("legacy flashcard deck ID is empty")
		}
		deckFile, readErr := readLegacyFile(root, entry.Name())
		if readErr != nil {
			return nil, nil, nil, readErr
		}
		var metadata riff.Deck
		if readErr = msgpack.Unmarshal(deckFile.data, &metadata); readErr != nil {
			return nil, nil, nil, fmt.Errorf("decode legacy flashcard deck [%s]: %w", deckID, readErr)
		}
		if metadata.ID != "" && metadata.ID != deckID {
			return nil, nil, nil, fmt.Errorf("legacy flashcard deck [%s] has a mismatched ID", deckID)
		}
		metadata.ID = deckID
		if metadata.Name == "" {
			metadata.Name = deckID
		}
		cards := map[string]*riff.FSRSCard{}
		var cardsFile *legacyFileInput
		cardsName := deckID + ".cards"
		if _, statErr := os.Lstat(filepath.Join(root, cardsName)); statErr == nil {
			file, cardsErr := readLegacyFile(root, cardsName)
			if cardsErr != nil {
				return nil, nil, nil, cardsErr
			}
			if cardsErr = msgpack.Unmarshal(file.data, &cards); cardsErr != nil {
				return nil, nil, nil, fmt.Errorf("decode legacy flashcard cards [%s]: %w", deckID, cardsErr)
			}
			cardsFile = &file
			fingerprints = append(fingerprints, file.fingerprint)
		} else if !os.IsNotExist(statErr) {
			return nil, nil, nil, fmt.Errorf("inspect legacy flashcard cards [%s]: %w", deckID, statErr)
		}
		fingerprints = append(fingerprints, deckFile.fingerprint)
		decks = append(decks, legacyDeckInput{
			id:        deckID,
			metadata:  metadata,
			cards:     cards,
			deckFile:  deckFile,
			cardsFile: cardsFile,
		})
	}
	if len(decks) == 0 {
		return nil, nil, nil, ErrNoLegacyFlashcards
	}
	sort.Slice(decks, func(i, j int) bool { return decks[i].id < decks[j].id })
	logs, logFingerprints, err := readLegacyLogs(root)
	if err != nil {
		return nil, nil, nil, err
	}
	fingerprints = append(fingerprints, logFingerprints...)
	sort.Slice(fingerprints, func(i, j int) bool { return fingerprints[i].Path < fingerprints[j].Path })
	return decks, logs, fingerprints, nil
}

func readLegacyLogs(root string) ([]legacyLogInput, []LegacyFileFingerprint, error) {
	logsRoot := filepath.Join(root, "logs")
	info, err := os.Lstat(logsRoot)
	if os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("inspect legacy flashcard logs: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return nil, nil, errors.New("legacy flashcard logs path is not a regular directory")
	}
	entries, err := os.ReadDir(logsRoot)
	if err != nil {
		return nil, nil, fmt.Errorf("read legacy flashcard logs: %w", err)
	}
	var ret []legacyLogInput
	var fingerprints []LegacyFileFingerprint
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".msgpack") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil, nil, errors.New("legacy flashcard log is a symbolic link")
		}
		file, readErr := readLegacyFile(root, filepath.Join("logs", entry.Name()))
		if readErr != nil {
			return nil, nil, readErr
		}
		var logs []*riff.Log
		if readErr = msgpack.Unmarshal(file.data, &logs); readErr != nil {
			return nil, nil, fmt.Errorf("decode legacy flashcard log [%s]: %w", entry.Name(), readErr)
		}
		ret = append(ret, legacyLogInput{file: file, logs: logs})
		fingerprints = append(fingerprints, file.fingerprint)
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].file.fingerprint.Path < ret[j].file.fingerprint.Path })
	return ret, fingerprints, nil
}

func readLegacyFile(root, relativePath string) (legacyFileInput, error) {
	path := filepath.Join(root, relativePath)
	before, err := os.Lstat(path)
	if err != nil {
		return legacyFileInput{}, fmt.Errorf("inspect legacy flashcard file [%s]: %w", filepath.ToSlash(relativePath), err)
	}
	if before.Mode()&fs.ModeSymlink != 0 || !before.Mode().IsRegular() {
		return legacyFileInput{}, errors.New("legacy flashcard input is not a regular file")
	}
	data, err := filelock.ReadFile(path)
	if err != nil {
		return legacyFileInput{}, fmt.Errorf("read legacy flashcard file [%s]: %w", filepath.ToSlash(relativePath), err)
	}
	after, err := os.Lstat(path)
	if err != nil || before.Size() != after.Size() || before.ModTime() != after.ModTime() {
		return legacyFileInput{}, errors.New("legacy flashcard input changed while preparing migration")
	}
	digest := sha256.Sum256(data)
	return legacyFileInput{
		fingerprint: LegacyFileFingerprint{
			Path:       filepath.ToSlash(relativePath),
			Size:       int64(len(data)),
			SHA256:     hex.EncodeToString(digest[:]),
			ModifiedAt: before.ModTime().UnixMilli(),
		},
		data: data,
	}, nil
}

func legacyMigrationID(fingerprints []LegacyFileFingerprint, options LegacyMigrationOptions) (string, error) {
	seed := struct {
		LegacyFormat  int                     `json:"legacyFormat"`
		InputFiles    []LegacyFileFingerprint `json:"inputFiles"`
		Preset        SchedulerPreset         `json:"preset"`
		EmptyDeckID   string                  `json:"emptyDeckID,omitempty"`
		EmptyDeckName string                  `json:"emptyDeckName,omitempty"`
	}{
		LegacyFormat:  legacyFormatVersion,
		InputFiles:    fingerprints,
		EmptyDeckID:   options.EmptyDeckID,
		EmptyDeckName: options.EmptyDeckName,
		Preset: SchedulerPreset{
			ID:                 legacyPresetID,
			Name:               options.PresetName,
			SchedulerVersion:   SchedulerVersionFSRS6,
			RequestRetention:   options.RequestRetention,
			MaximumInterval:    options.MaximumInterval,
			Weights:            options.Weights,
			NewLimit:           options.NewLimit,
			ReviewLimit:        options.ReviewLimit,
			BuryNewSiblings:    options.BuryNewSiblings,
			BuryReviewSiblings: options.BuryReviewSiblings,
			LeechThreshold:     options.LeechThreshold,
			LeechAction:        options.LeechAction,
		},
	}
	digest, err := checksum(seed)
	if err != nil {
		return "", err
	}
	return DeterministicID("legacy-migration-v1", digest), nil
}

func buildLegacyRecords(ctx context.Context, decks []legacyDeckInput, logs []legacyLogInput,
	options LegacyMigrationOptions, report *LegacyMigrationReport,
	operationID string) ([]plannedEntity, []Event, int64, error) {
	var records []legacyCardRecord
	logicalTime := int64(0)
	deckNames := map[string]string{}
	for _, deck := range decks {
		deckNames[deck.id] = deck.metadata.Name
		createdAt := normalizeLegacyTimestamp(deck.metadata.Created)
		updatedAt := normalizeLegacyTimestamp(deck.metadata.Updated)
		logicalTime = maxInt64(logicalTime, updatedAt)
		cardIDs := make([]string, 0, len(deck.cards))
		for cardID := range deck.cards {
			cardIDs = append(cardIDs, cardID)
		}
		sort.Strings(cardIDs)
		for _, cardID := range cardIDs {
			report.LegacyCards++
			card := deck.cards[cardID]
			if card == nil || card.BaseCard == nil || card.C == nil || strings.TrimSpace(cardID) == "" ||
				strings.TrimSpace(card.BlockID()) == "" {
				report.InvalidCards++
				report.Complete = false
				continue
			}
			if _, validState := legacyStateName(riff.State(card.C.State)); !validState {
				report.InvalidCards++
				report.Complete = false
				continue
			}
			records = append(records, legacyCardRecord{
				deckID:    deck.id,
				cardID:    cardID,
				blockID:   card.BlockID(),
				card:      card.C,
				createdAt: createdAt,
				updatedAt: maxInt64(updatedAt, timeToMillis(card.C.LastReview)),
			})
		}
	}
	grouped := map[string][]legacyCardRecord{}
	for _, record := range records {
		grouped[record.blockID] = append(grouped[record.blockID], record)
	}
	blockIDs := make([]string, 0, len(grouped))
	for blockID := range grouped {
		blockIDs = append(blockIDs, blockID)
	}
	sort.Strings(blockIDs)
	var entities []plannedEntity
	safeCardMappings := map[string]map[string]string{}
	encryptedLegacyCardIDs := map[string]struct{}{}
	deckCards := map[string]map[string]struct{}{}
	if len(decks) > 0 {
		entities = append(entities, builtinLegacyEntities(options, logicalTime)...)
	}
	for _, blockID := range blockIDs {
		blockInfo, resolveErr := options.ResolveBlock(ctx, blockID)
		if resolveErr != nil {
			return nil, nil, 0, errors.New("resolve legacy flashcard block for migration failed")
		}
		blockRecords := grouped[blockID]
		if blockInfo.Encrypted {
			report.SkippedEncryptedCards += len(blockRecords)
			for _, record := range blockRecords {
				encryptedLegacyCardIDs[record.cardID] = struct{}{}
			}
			continue
		}
		sort.Slice(blockRecords, func(i, j int) bool {
			if blockRecords[i].deckID != blockRecords[j].deckID {
				return blockRecords[i].deckID < blockRecords[j].deckID
			}
			return blockRecords[i].cardID < blockRecords[j].cardID
		})
		selected := selectLegacyState(blockRecords)
		sourceID := DeterministicID("legacy-card-source", blockID)
		refID := DeterministicID("legacy-card-source-ref", sourceID, legacyQuickFieldID, blockID)
		cardID := GeneratedCardID(sourceID, legacyQuickTemplateID, "legacy-quick")
		status := "active"
		generationStatus := GenerationActive
		if !blockInfo.Exists {
			status = "orphaned"
			generationStatus = GenerationOrphaned
			report.OrphanedSources++
		}
		generationConfig := json.RawMessage(`{"legacyQuick":true}`)
		entities = append(entities,
			plannedEntity{entityType: EntityCardSource, entityID: sourceID, updatedAt: selected.updatedAt, payload: CardSource{
				ID: sourceID, SchemaID: legacyQuickSchemaID, SourceType: "block", PrimaryRefID: refID,
				DefaultPresetID: legacyPresetID, GenerationConfig: generationConfig, Status: status,
			}},
			plannedEntity{entityType: EntityCardSourceRef, entityID: refID, updatedAt: selected.updatedAt,
				payload: CardSourceRef{ID: refID, SourceID: sourceID, FieldID: legacyQuickFieldID, EntityType: "block",
					EntityID: blockID, Role: "content", Sort: 0, Required: true}},
			plannedEntity{entityType: EntityCard, entityID: cardID, updatedAt: selected.updatedAt, payload: Card{
				ID: cardID, SourceID: sourceID, TemplateID: legacyQuickTemplateID, VariantKey: "legacy-quick",
				GenerationStatus: generationStatus, CreatedAt: selected.createdAt, UpdatedAt: selected.updatedAt,
			}},
		)
		stateRevisionID := OperationRevisionID(operationID, EntityReviewState, cardID)
		currentState := legacyReviewState(selected.card, stateRevisionID)
		entities = append(entities, plannedEntity{entityType: EntityReviewState, entityID: cardID,
			updatedAt: selected.updatedAt, payload: ReviewState{CardID: cardID, ReviewStateSnapshot: currentState}})
		for _, record := range blockRecords {
			aliasID := DeterministicID("legacy-card-alias", record.deckID, record.cardID)
			aliasState := legacyReviewState(record.card,
				DeterministicID("legacy-card-state", record.deckID, record.cardID))
			entities = append(entities, plannedEntity{entityType: EntityLegacyCardAlias, entityID: aliasID,
				updatedAt: record.updatedAt, payload: LegacyCardAlias{
					ID: aliasID, LegacyDeckID: record.deckID, LegacyCardID: record.cardID, BlockID: blockID,
					CardID: cardID, Selected: record.deckID == selected.deckID && record.cardID == selected.cardID,
					State: &aliasState,
				}})
			if safeCardMappings[record.cardID] == nil {
				safeCardMappings[record.cardID] = map[string]string{}
			}
			safeCardMappings[record.cardID][cardID] = sourceID
			if deckCards[record.deckID] == nil {
				deckCards[record.deckID] = map[string]struct{}{}
			}
			deckCards[record.deckID][cardID] = struct{}{}
		}
		report.MigratedSources++
		report.MigratedCards++
		if len(blockRecords) > 1 {
			report.MergedCards += len(blockRecords) - 1
		}
		logicalTime = maxInt64(logicalTime, selected.updatedAt)
	}
	archivedEntities, archivedLogicalTime := buildLegacyHistoryRecords(logs, safeCardMappings,
		encryptedLegacyCardIDs, report)
	entities = append(entities, archivedEntities...)
	logicalTime = maxInt64(logicalTime, archivedLogicalTime)
	for _, deck := range decks {
		cards := deckCards[deck.id]
		reviewSetID := DeterministicID("legacy-review-set", deck.id)
		entities = append(entities, plannedEntity{entityType: EntityReviewSet, entityID: reviewSetID,
			updatedAt: normalizeLegacyTimestamp(deck.metadata.Updated), payload: ReviewSet{
				ID: reviewSetID, Name: deckNames[deck.id], LegacyDeckID: deck.id, NewLimit: options.NewLimit,
				ReviewLimit: options.ReviewLimit, DefaultReviewMode: "normal",
			}})
		cardIDs := make([]string, 0, len(cards))
		for cardID := range cards {
			cardIDs = append(cardIDs, cardID)
		}
		sort.Strings(cardIDs)
		for _, cardID := range cardIDs {
			membershipID := DeterministicID("legacy-review-set-membership", reviewSetID, cardID)
			entities = append(entities, plannedEntity{entityType: EntityReviewSetMembership, entityID: membershipID,
				updatedAt: normalizeLegacyTimestamp(deck.metadata.Updated), payload: ReviewSetMembership{
					ID: membershipID, ReviewSetID: reviewSetID, CardID: cardID, Mode: MembershipInclude,
				}})
		}
		report.ReviewSets++
	}
	reviewEvents := buildLegacyReviewEvents(logs, safeCardMappings, encryptedLegacyCardIDs, report)
	for _, event := range reviewEvents {
		logicalTime = maxInt64(logicalTime, event.OccurredAt)
	}
	return entities, reviewEvents, logicalTime, nil
}

// buildLegacyHistoryRecords 为已从当前卡文件移除但仍有复习日志的旧卡建立不可复习的审计映射。
func buildLegacyHistoryRecords(logFiles []legacyLogInput, mappings map[string]map[string]string,
	encryptedCardIDs map[string]struct{}, report *LegacyMigrationReport) ([]plannedEntity, int64) {
	type historyRange struct {
		createdAt int64
		updatedAt int64
	}
	ranges := map[string]historyRange{}
	for _, logFile := range logFiles {
		for _, log := range logFile.logs {
			if log == nil || strings.TrimSpace(log.CardID) == "" {
				continue
			}
			if _, encrypted := encryptedCardIDs[log.CardID]; encrypted {
				continue
			}
			reviewedAt := normalizeLegacyTimestamp(log.Reviewed)
			current, found := ranges[log.CardID]
			if !found || reviewedAt < current.createdAt {
				current.createdAt = reviewedAt
			}
			if !found || reviewedAt > current.updatedAt {
				current.updatedAt = reviewedAt
			}
			ranges[log.CardID] = current
		}
	}
	legacyCardIDs := make([]string, 0, len(ranges))
	for legacyCardID := range ranges {
		legacyCardIDs = append(legacyCardIDs, legacyCardID)
	}
	sort.Strings(legacyCardIDs)
	entities := make([]plannedEntity, 0, len(legacyCardIDs)*4)
	logicalTime := int64(0)
	for _, legacyCardID := range legacyCardIDs {
		history := ranges[legacyCardID]
		cardMappings := mappings[legacyCardID]
		cardID := ""
		sourceID := ""
		if len(cardMappings) == 1 {
			for mappedCardID, mappedSourceID := range cardMappings {
				cardID = mappedCardID
				sourceID = mappedSourceID
			}
		} else {
			sourceID = DeterministicID("legacy-history-source", legacyCardID)
			refID := DeterministicID("legacy-history-source-ref", legacyCardID)
			cardID = DeterministicID("legacy-history-card", legacyCardID)
			entities = append(entities,
				plannedEntity{entityType: EntityCardSource, entityID: sourceID, updatedAt: history.updatedAt,
					payload: CardSource{ID: sourceID, SchemaID: legacyQuickSchemaID, SourceType: "legacy-history",
						PrimaryRefID: refID, DefaultPresetID: legacyPresetID,
						GenerationConfig: json.RawMessage(`{"legacyHistory":true}`), Status: "deleted"}},
				plannedEntity{entityType: EntityCardSourceRef, entityID: refID, updatedAt: history.updatedAt,
					payload: CardSourceRef{ID: refID, SourceID: sourceID, FieldID: legacyQuickFieldID,
						EntityType: "legacy-card-history", EntityID: legacyCardID, Role: "history", Sort: 0}},
				plannedEntity{entityType: EntityCard, entityID: cardID, updatedAt: history.updatedAt,
					payload: Card{ID: cardID, SourceID: sourceID, TemplateID: legacyQuickTemplateID,
						VariantKey: "legacy-history", GenerationStatus: GenerationDeleted,
						CreatedAt: history.createdAt, UpdatedAt: history.updatedAt}},
			)
			mappings[legacyCardID] = map[string]string{cardID: sourceID}
			report.ArchivedCards++
		}
		aliasID := DeterministicID("legacy-history-alias", legacyCardID)
		entities = append(entities,
			plannedEntity{entityType: EntityLegacyCardAlias, entityID: aliasID, updatedAt: history.updatedAt,
				payload: LegacyCardAlias{ID: aliasID, LegacyCardID: legacyCardID, CardID: cardID,
					HistoryOnly: true}},
		)
		logicalTime = maxInt64(logicalTime, history.updatedAt)
	}
	return entities, logicalTime
}

func builtinLegacyEntities(options LegacyMigrationOptions, updatedAt int64) []plannedEntity {
	fields := []CardSchemaField{{ID: legacyQuickFieldID, Name: "Content", Type: "block", Required: true, Sort: 0}}
	templateIDs := []string{legacyQuickTemplateID}
	return []plannedEntity{
		{entityType: EntityCardSchema, entityID: legacyQuickSchemaID, updatedAt: updatedAt, payload: CardSchema{
			ID: legacyQuickSchemaID, Name: "Legacy Quick Card", BuiltinType: "legacy-quick", Fields: fields,
			TemplateIDs: templateIDs, CreatedAt: updatedAt, UpdatedAt: updatedAt,
		}},
		{entityType: EntityCardTemplate, entityID: legacyQuickTemplateID, updatedAt: updatedAt, payload: CardTemplate{
			ID: legacyQuickTemplateID, SchemaID: legacyQuickSchemaID, Name: "Legacy Quick Card",
			GenerationRule: json.RawMessage(`{"mode":"static","variantKey":"legacy-quick"}`),
			FrontSpec:      json.RawMessage(`{"side":"front","type":"legacyQuick"}`),
			BackSpec:       json.RawMessage(`{"side":"back","type":"legacyQuick"}`),
			AnswerMode:     "reveal", ContextPolicy: json.RawMessage(`{"type":"legacy"}`), Enabled: true,
		}},
		{entityType: EntitySchedulerPreset, entityID: legacyPresetID, updatedAt: updatedAt, payload: SchedulerPreset{
			ID: legacyPresetID, Name: options.PresetName, SchedulerVersion: SchedulerVersionFSRS6,
			RequestRetention: options.RequestRetention,
			MaximumInterval:  options.MaximumInterval, Weights: append([]float64(nil), options.Weights...),
			NewLimit: options.NewLimit, ReviewLimit: options.ReviewLimit, BuryNewSiblings: options.BuryNewSiblings,
			BuryReviewSiblings: options.BuryReviewSiblings, LeechThreshold: options.LeechThreshold,
			LeechAction: options.LeechAction,
		}},
	}
}

func selectLegacyState(records []legacyCardRecord) legacyCardRecord {
	selected := records[0]
	for _, candidate := range records[1:] {
		selectedReview := timeToMillis(selected.card.LastReview)
		candidateReview := timeToMillis(candidate.card.LastReview)
		if candidateReview > selectedReview || (candidateReview == selectedReview &&
			(candidate.deckID < selected.deckID || candidate.deckID == selected.deckID && candidate.cardID < selected.cardID)) {
			selected = candidate
		}
	}
	return selected
}

func legacyReviewState(card *fsrs.Card, stateRevisionID string) ReviewStateSnapshot {
	state, _ := legacyStateName(riff.State(card.State))
	return ReviewStateSnapshot{
		State:           state,
		Due:             timeToMillis(card.Due),
		LastReview:      timeToMillis(card.LastReview),
		Stability:       card.Stability,
		Difficulty:      card.Difficulty,
		ElapsedDays:     card.ElapsedDays,
		ScheduledDays:   card.ScheduledDays,
		Reps:            card.Reps,
		Lapses:          card.Lapses,
		StateRevisionID: stateRevisionID,
	}
}

func buildLegacyReviewEvents(logFiles []legacyLogInput, mappings map[string]map[string]string,
	encryptedCardIDs map[string]struct{}, report *LegacyMigrationReport) []Event {
	var ret []Event
	for _, logFile := range logFiles {
		for index, log := range logFile.logs {
			if log == nil {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			if _, encrypted := encryptedCardIDs[log.CardID]; encrypted {
				report.SkippedEncryptedLogs++
				continue
			}
			cards := mappings[log.CardID]
			if len(cards) != 1 {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			cardID := ""
			for mappedCardID := range cards {
				cardID = mappedCardID
			}
			rating, validRating := legacyRating(log.Rating)
			if !validRating {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			sourceID := cards[cardID]
			if sourceID == "" {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			state, validState := legacyStateName(log.State)
			if !validState {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			schedulerInput, _ := CanonicalJSON(map[string]any{
				"elapsedDays":   log.ElapsedDays,
				"scheduledDays": log.ScheduledDays,
				"state":         state,
			})
			reviewedAt := normalizeLegacyTimestamp(log.Reviewed)
			payload := ReviewEventPayload{
				CardID: cardID, SourceID: sourceID, OriginCardID: log.CardID, Kind: "review", Rating: rating,
				ReviewedAt: reviewedAt, SchedulerVersion: "legacy-unknown", PresetRevisionID: "legacy-unknown",
				SchedulerInput: schedulerInput, ReviewMode: "normal",
			}
			payloadJSON, payloadErr := CanonicalJSON(payload)
			if payloadErr != nil {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			event := Event{
				EventType: EventReview,
				EventID: DeterministicID("legacy-review-event", fmt.Sprintf("%d", legacyFormatVersion),
					logFile.file.fingerprint.Path, fmt.Sprintf("%d", index), log.ID, log.CardID),
				EntityID: cardID, OccurredAt: reviewedAt, Payload: payloadJSON,
			}
			if event.Validate() != nil {
				report.UnmappedLogs++
				report.Complete = false
				continue
			}
			ret = append(ret, event)
			report.ReviewEvents++
		}
	}
	return ret
}

func legacyRating(rating riff.Rating) (ReviewRating, bool) {
	switch rating {
	case riff.Again:
		return ReviewAgain, true
	case riff.Hard:
		return ReviewHard, true
	case riff.Good:
		return ReviewGood, true
	case riff.Easy:
		return ReviewEasy, true
	default:
		return "", false
	}
}

func legacyStateName(state riff.State) (string, bool) {
	switch state {
	case riff.New:
		return "new", true
	case riff.Learning:
		return "learning", true
	case riff.Review:
		return "review", true
	case riff.Relearning:
		return "relearning", true
	default:
		return "", false
	}
}

func normalizeLegacyTimestamp(value int64) int64 {
	if value <= 0 {
		return 0
	}
	if value < 100_000_000_000 {
		return value * 1000
	}
	return value
}

func timeToMillis(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.UnixMilli()
}

func maxInt64(first, second int64) int64 {
	if first > second {
		return first
	}
	return second
}
