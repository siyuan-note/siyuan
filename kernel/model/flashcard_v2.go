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

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/siyuan-note/logging"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	kernelsql "github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	flashcardV2StoreMu sync.Mutex
	flashcardV2Store   *flashcardv2.Store
)

// LegacyFlashcardMigrationPreview 是不会把候选权威记录全部复制到 HTTP 响应中的迁移摘要。
type LegacyFlashcardMigrationPreview struct {
	MigrationID  string                              `json:"migrationID"`
	RecordDigest string                              `json:"recordDigest"`
	InputFiles   []flashcardv2.LegacyFileFingerprint `json:"inputFiles"`
	Report       flashcardv2.LegacyMigrationReport   `json:"report"`
}

// FlashcardV2CardSearchResult 为管理列表补充不含完整块 DOM 的卡源摘要。
type FlashcardV2CardSearchResult struct {
	flashcardv2.CardSearchResult
	SourceBlockID string `json:"sourceBlockID,omitempty"`
	SourceTitle   string `json:"sourceTitle,omitempty"`
}

// PreviewFlashcardV2AnkiPackage 只读分析 Anki 卡包结构和模板兼容性。
func PreviewFlashcardV2AnkiPackage(ctx context.Context, packagePath string) (flashcardv2.AnkiPackagePreview, error) {
	return flashcardv2.PreviewAnkiPackage(ctx, packagePath)
}

func openFlashcardV2Store(ctx context.Context) (*flashcardv2.Store, error) {
	flashcardV2StoreMu.Lock()
	defer flashcardV2StoreMu.Unlock()
	if flashcardV2Store != nil {
		return flashcardV2Store, nil
	}
	store, err := flashcardv2.OpenStore(ctx, flashcardv2.V2Root(util.DataDir),
		flashcardv2.ProjectionPath(util.TempDir), Conf.System.ID, nil)
	if err != nil {
		return nil, err
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err == nil && status.State == flashcardv2.MigrationStateActive {
		status, err = store.CheckLegacyDivergence(ctx, getRiffDir())
	}
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		_ = store.Close()
		return nil, err
	}
	flashcardV2Store = store
	return store, nil
}

func refreshFlashcardV2Store() {
	flashcardV2StoreMu.Lock()
	store := flashcardV2Store
	flashcardV2StoreMu.Unlock()
	if store == nil {
		return
	}
	ctx := context.Background()
	if err := store.Refresh(ctx); err != nil {
		logging.LogErrorf("refresh flashcard v2 store failed: %s", err)
		return
	}
	if err := refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		logging.LogErrorf("refresh flashcard v2 block metadata failed: %s", err)
		return
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err == nil && status.State == flashcardv2.MigrationStateActive {
		_, err = store.CheckLegacyDivergence(ctx, getRiffDir())
	}
	if err != nil {
		logging.LogErrorf("check legacy flashcard divergence failed: %s", err)
	}
}

func refreshFlashcardV2BlockMetadata(ctx context.Context, store *flashcardv2.Store,
	reconcile bool) error {
	blockIDs, err := store.Projection().RequiredBlockMetadataIDs(ctx)
	if err != nil {
		return err
	}
	dependencies, err := store.Projection().SourceBlockDependencies(ctx)
	if err != nil {
		return err
	}
	allBlockIDs := append([]string(nil), blockIDs...)
	seenBlockIDs := make(map[string]struct{}, len(blockIDs))
	for _, blockID := range blockIDs {
		seenBlockIDs[blockID] = struct{}{}
	}
	for _, dependency := range dependencies {
		for _, blockID := range dependency.BlockIDs {
			if _, found := seenBlockIDs[blockID]; found {
				continue
			}
			seenBlockIDs[blockID] = struct{}{}
			allBlockIDs = append(allBlockIDs, blockID)
		}
	}
	const chunkSize = 500
	blockTrees := make(map[string]*treenode.BlockTree, len(allBlockIDs))
	for offset := 0; offset < len(allBlockIDs); offset += chunkSize {
		end := min(offset+chunkSize, len(allBlockIDs))
		for blockID, blockTree := range treenode.GetBlockTrees(allBlockIDs[offset:end]) {
			if blockTree == nil || IsEncryptedBox(blockTree.BoxID) {
				continue
			}
			blockTrees[blockID] = blockTree
		}
	}
	metadata := make([]flashcardv2.BlockMetadata, 0, len(blockIDs))
	for _, blockID := range blockIDs {
		if blockTree := blockTrees[blockID]; blockTree != nil {
			metadata = append(metadata, flashcardv2.BlockMetadata{BlockID: blockTree.ID,
				NotebookID: blockTree.BoxID, RootID: blockTree.RootID, Path: blockTree.Path, HPath: blockTree.HPath})
		}
	}
	availability := make(map[string]bool, len(dependencies))
	for _, dependency := range dependencies {
		available := true
		for _, blockID := range dependency.BlockIDs {
			if blockTrees[blockID] == nil {
				available = false
				break
			}
		}
		availability[dependency.SourceID] = available
	}
	if err = store.Projection().ReplaceBlockMetadataAndSourceAvailability(ctx, metadata, availability); err != nil {
		return err
	}
	if !reconcile {
		return nil
	}
	return reconcileFlashcardV2SourceAvailability(ctx, store, dependencies, blockTrees)
}

func reconcileFlashcardV2SourceAvailability(ctx context.Context, store *flashcardv2.Store,
	dependencies []flashcardv2.SourceBlockDependency, blockTrees map[string]*treenode.BlockTree) error {
	for _, dependency := range dependencies {
		missing := false
		for _, blockID := range dependency.BlockIDs {
			if blockTrees[blockID] == nil {
				missing = true
				break
			}
		}
		revision, found, err := store.Projection().CurrentEntity(ctx, flashcardv2.EntityCardSource,
			dependency.SourceID)
		if err != nil {
			return err
		}
		if !found || revision.Deleted {
			continue
		}
		var source flashcardv2.CardSource
		if err = json.Unmarshal(revision.Payload, &source); err != nil {
			return err
		}
		desiredStatus := "active"
		if missing {
			desiredStatus = "orphaned"
		}
		if source.Status == "deleted" || source.Status == desiredStatus {
			continue
		}
		source.Status = desiredStatus
		updatedAt := revision.UpdatedAt + 1
		payload, err := json.Marshal(source)
		if err != nil {
			return err
		}
		operationID := flashcardv2.DeterministicID("source-availability", source.ID, revision.RevisionID,
			desiredStatus)
		mutation, err := store.MutateEntities(ctx, operationID, []flashcardv2.EntityMutation{{
			EntityType: flashcardv2.EntityCardSource, EntityID: source.ID,
			ExpectedRevisionID: revision.RevisionID, UpdatedAt: updatedAt, Payload: payload,
		}})
		if err != nil {
			if errors.Is(err, flashcardv2.ErrRevisionConflict) {
				continue
			}
			return err
		}
		if len(mutation.Revisions) != 1 {
			return errors.New("flashcard source availability mutation is incomplete")
		}
		reconcileOperationID := flashcardv2.DeterministicID("source-availability-cards", source.ID,
			mutation.Revisions[0].RevisionID)
		if _, err = store.ReconcileSourceCards(ctx, reconcileOperationID, source.ID, updatedAt+1); err != nil {
			return err
		}
	}
	return nil
}

func closeFlashcardV2Store() {
	flashcardV2StoreMu.Lock()
	store := flashcardV2Store
	flashcardV2Store = nil
	flashcardV2StoreMu.Unlock()
	if store != nil {
		if err := store.Close(); err != nil {
			logging.LogErrorf("close flashcard v2 store failed: %s", err)
		}
	}
}

// GetFlashcardV2MigrationStatus 返回只读迁移状态，不存在 v2 目录时不会创建同步文件。
func GetFlashcardV2MigrationStatus(ctx context.Context) (flashcardv2.LegacyMigrationStatus, error) {
	flashcardV2StoreMu.Lock()
	store := flashcardV2Store
	flashcardV2StoreMu.Unlock()
	if store == nil {
		if _, err := os.Stat(filepath.Join(flashcardv2.V2Root(util.DataDir), "manifest.json")); os.IsNotExist(err) {
			return flashcardv2.LegacyMigrationStatus{State: flashcardv2.MigrationStateLegacy}, nil
		}
		var err error
		if store, err = openFlashcardV2Store(ctx); err != nil {
			return flashcardv2.LegacyMigrationStatus{}, err
		}
	}
	return store.LegacyMigrationStatus(ctx)
}

// PreviewLegacyFlashcardMigration 读取旧存储并生成确定性、无副作用的迁移摘要。
func PreviewLegacyFlashcardMigration(ctx context.Context) (LegacyFlashcardMigrationPreview, error) {
	deckLock.Lock()
	defer deckLock.Unlock()
	waitForSyncingStorages()
	plan, err := flashcardv2.PrepareLegacyMigration(ctx, getRiffDir(), legacyFlashcardMigrationOptions())
	if err != nil {
		return LegacyFlashcardMigrationPreview{}, err
	}
	return LegacyFlashcardMigrationPreview{
		MigrationID: plan.MigrationID, RecordDigest: plan.RecordDigest,
		InputFiles: append([]flashcardv2.LegacyFileFingerprint(nil), plan.InputFiles...), Report: plan.Report,
	}, nil
}

// ActivateLegacyFlashcardMigration 重新生成并核对预览，然后才写入 v2 权威记录和激活事件。
func ActivateLegacyFlashcardMigration(ctx context.Context, migrationID,
	recordDigest string) (flashcardv2.LegacyActivationResult, error) {
	deckLock.Lock()
	defer deckLock.Unlock()
	waitForSyncingStorages()
	plan, err := flashcardv2.PrepareLegacyMigration(ctx, getRiffDir(), legacyFlashcardMigrationOptions())
	if err != nil {
		return flashcardv2.LegacyActivationResult{}, err
	}
	if plan.MigrationID != migrationID || plan.RecordDigest != recordDigest {
		return flashcardv2.LegacyActivationResult{}, errors.New("legacy flashcard migration preview is stale")
	}
	store, err := openFlashcardV2Store(ctx)
	if err != nil {
		return flashcardv2.LegacyActivationResult{}, err
	}
	return store.ActivateLegacyMigration(ctx, getRiffDir(), plan)
}

func legacyFlashcardMigrationOptions() flashcardv2.LegacyMigrationOptions {
	return flashcardv2.LegacyMigrationOptions{
		RequestRetention:   Conf.Flashcard.RequestRetention,
		MaximumInterval:    Conf.Flashcard.MaximumInterval,
		Weights:            flashcardV2Weights(),
		NewLimit:           Conf.Flashcard.NewCardLimit,
		ReviewLimit:        Conf.Flashcard.ReviewCardLimit,
		BuryNewSiblings:    true,
		BuryReviewSiblings: true,
		LeechThreshold:     8,
		LeechAction:        "tag",
		PresetName:         "Default",
		EmptyDeckID:        builtinDeckID,
		EmptyDeckName:      "Built-in Deck",
		ResolveBlock: func(_ context.Context, blockID string) (flashcardv2.LegacyBlockInfo, error) {
			blockTree := treenode.GetBlockTree(blockID)
			if blockTree == nil {
				return flashcardv2.LegacyBlockInfo{}, nil
			}
			return flashcardv2.LegacyBlockInfo{Exists: true, Encrypted: IsEncryptedBox(blockTree.BoxID)}, nil
		},
	}
}

func flashcardV2Weights() []float64 {
	ret := make([]float64, 0, 19)
	for value := range strings.SplitSeq(Conf.Flashcard.Weights, ",") {
		weight, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return nil
		}
		ret = append(ret, weight)
	}
	return ret
}

func requireFlashcardV2Store(ctx context.Context, writable bool) (*flashcardv2.Store, error) {
	store, err := openFlashcardV2Store(ctx)
	if err != nil {
		return nil, err
	}
	if !writable {
		return store, nil
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err != nil {
		return nil, err
	}
	if status.State != flashcardv2.MigrationStateActive {
		if status.State == flashcardv2.MigrationStateLegacyDiverged {
			return nil, errors.New("legacy flashcard data diverged after v2 activation")
		}
		return nil, errors.New("flashcard v2 migration is not active")
	}
	return store, nil
}

// MutateFlashcardV2Entities 校验内容隔离边界后写入版本化实体。
func MutateFlashcardV2Entities(ctx context.Context, operationID string,
	mutations []flashcardv2.EntityMutation) (flashcardv2.EntityMutationResult, error) {
	if err := validateFlashcardV2Mutations(mutations); err != nil {
		return flashcardv2.EntityMutationResult{}, err
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.EntityMutationResult{}, err
	}
	return store.MutateEntities(ctx, operationID, mutations)
}

func validateFlashcardV2Mutations(mutations []flashcardv2.EntityMutation) error {
	for _, mutation := range mutations {
		switch mutation.EntityType {
		case flashcardv2.EntityCard, flashcardv2.EntityReviewState, flashcardv2.EntityReviewSetMembership,
			flashcardv2.EntityTagAssignment, flashcardv2.EntityStudySession, flashcardv2.EntitySessionCard,
			flashcardv2.EntityLegacyCardAlias:
			return fmt.Errorf("flashcard entity type [%s] must use its dedicated API", mutation.EntityType)
		}
		if mutation.Deleted {
			continue
		}
		switch mutation.EntityType {
		case flashcardv2.EntityCardSourceRef:
			var ref flashcardv2.CardSourceRef
			if err := json.Unmarshal(mutation.Payload, &ref); err != nil {
				return err
			}
			if ref.EntityType == "block" {
				if err := ValidateFlashcardBlockIDs([]string{ref.EntityID}); err != nil {
					return err
				}
			}
		case flashcardv2.EntityStudyPolicy:
			var policy flashcardv2.StudyPolicy
			if err := json.Unmarshal(mutation.Payload, &policy); err != nil {
				return err
			}
			if err := validateFlashcardV2StudyPolicyScope(policy.ScopeType, policy.ScopeID); err != nil {
				return err
			}
			return errors.New("flashcard study policies must use the dedicated save API")
		}
	}
	return nil
}

func validateFlashcardV2StudyPolicyScope(scopeType, scopeID string) error {
	if scopeType == "notebook" {
		if Conf.Box(scopeID) == nil {
			return fmt.Errorf("flashcard notebook [%s] was not found", scopeID)
		}
		if IsEncryptedBox(scopeID) {
			return errors.New(Conf.Language(313))
		}
		return nil
	}
	if scopeType != "document" {
		return errors.New("flashcard study policy scope type is invalid")
	}
	if err := ValidateFlashcardBlockIDs([]string{scopeID}); err != nil {
		return err
	}
	blockTree := treenode.GetBlockTree(scopeID)
	if blockTree == nil || blockTree.RootID != scopeID {
		return errors.New("flashcard document study policy scope must be a document block")
	}
	return nil
}

// GetFlashcardV2Entity 返回当前实体修订。
func GetFlashcardV2Entity(ctx context.Context, entityType flashcardv2.EntityType,
	entityID string) (flashcardv2.EntityRevision, bool, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.EntityRevision{}, false, err
	}
	return store.Projection().CurrentEntity(ctx, entityType, entityID)
}

// ListFlashcardV2Entities 分页返回模板、复习集、预设、标签等当前实体。
func ListFlashcardV2Entities(ctx context.Context, entityType flashcardv2.EntityType,
	options flashcardv2.EntityListOptions) (flashcardv2.EntityPage, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.EntityPage{}, err
	}
	return store.Projection().ListEntities(ctx, entityType, options)
}

// QueryFlashcardV2Cards 使用同一结构化 AST 查询管理范围。
func QueryFlashcardV2Cards(ctx context.Context, query *flashcardv2.QueryAST,
	options flashcardv2.CardSearchOptions) ([]FlashcardV2CardSearchResult, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		return nil, err
	}
	results, err := store.Projection().SearchCards(ctx, query, options)
	if err != nil {
		return nil, err
	}
	if err = validateFlashcardV2SearchResults(ctx, store, results); err != nil {
		return nil, err
	}
	return decorateFlashcardV2SearchResults(ctx, store, results)
}

func decorateFlashcardV2SearchResults(ctx context.Context, store *flashcardv2.Store,
	results []flashcardv2.CardSearchResult) ([]FlashcardV2CardSearchResult, error) {
	ret := make([]FlashcardV2CardSearchResult, len(results))
	sourceBlocks := map[string]string{}
	blockIDs := make([]string, 0)
	seenBlocks := map[string]struct{}{}
	for index, result := range results {
		ret[index].CardSearchResult = result
		if _, found := sourceBlocks[result.Card.SourceID]; found {
			continue
		}
		sourceRevision, found, err := store.Projection().CurrentEntity(ctx, flashcardv2.EntityCardSource,
			result.Card.SourceID)
		if err != nil {
			return nil, err
		}
		if !found || sourceRevision.Deleted {
			return nil, flashcardv2.ErrEntityNotFound
		}
		var source flashcardv2.CardSource
		if err = json.Unmarshal(sourceRevision.Payload, &source); err != nil {
			return nil, err
		}
		references, err := store.Projection().CardSourceReferences(ctx, result.Card.SourceID)
		if err != nil {
			return nil, err
		}
		for _, reference := range references {
			if reference.ID != source.PrimaryRefID || reference.EntityType != "block" {
				continue
			}
			sourceBlocks[result.Card.SourceID] = reference.EntityID
			if _, blockFound := seenBlocks[reference.EntityID]; !blockFound {
				seenBlocks[reference.EntityID] = struct{}{}
				blockIDs = append(blockIDs, reference.EntityID)
			}
			break
		}
	}
	titles := map[string]string{}
	for _, block := range kernelsql.GetBlocks(blockIDs) {
		if block != nil {
			titles[block.ID] = truncateFlashcardV2Title(block.Content, 160)
		}
	}
	for index := range ret {
		ret[index].SourceBlockID = sourceBlocks[ret[index].Card.SourceID]
		ret[index].SourceTitle = titles[ret[index].SourceBlockID]
	}
	return ret, nil
}

func truncateFlashcardV2Title(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

// PreviewFlashcardV2ReviewSet 返回动态查询、手动纳入和排除合并后的卡片 ID。
func PreviewFlashcardV2ReviewSet(ctx context.Context, reviewSetID string,
	options flashcardv2.CardSearchOptions) (flashcardv2.ReviewSetCardPage, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.ReviewSetCardPage{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		return flashcardv2.ReviewSetCardPage{}, err
	}
	page, err := store.Projection().ReviewSetCardPage(ctx, reviewSetID, options)
	if err != nil {
		return flashcardv2.ReviewSetCardPage{}, err
	}
	if !options.IncludeInactive {
		err = validateFlashcardV2CardIDs(ctx, store, page.CardIDs)
	}
	if err != nil {
		return flashcardv2.ReviewSetCardPage{}, err
	}
	return page, nil
}

// ReconcileFlashcardV2Source 根据稳定变体键协调卡源生成的全部卡片。
func ReconcileFlashcardV2Source(ctx context.Context, operationID, sourceID string,
	updatedAt int64) (flashcardv2.ReconcileResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.ReconcileResult{}, err
	}
	if err = validateFlashcardV2Source(ctx, store, sourceID); err != nil {
		return flashcardv2.ReconcileResult{}, err
	}
	return store.ReconcileSourceCards(ctx, operationID, sourceID, updatedAt)
}

// CreateFlashcardV2BasicSource 由有序普通块创建正向、反向或双向卡源。
func CreateFlashcardV2BasicSource(ctx context.Context,
	request flashcardv2.BasicSourceRequest) (flashcardv2.BasicSourceResult, error) {
	if err := ValidateFlashcardBlockIDs(request.BlockIDs); err != nil {
		return flashcardv2.BasicSourceResult{}, err
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.BasicSourceResult{}, err
	}
	return store.CreateBasicSource(ctx, request)
}

// CreateFlashcardV2AdvancedSource 由有序普通块创建分组挖空或有序多空卡源。
func CreateFlashcardV2AdvancedSource(ctx context.Context,
	request flashcardv2.AdvancedSourceRequest) (flashcardv2.AdvancedSourceResult, error) {
	if err := ValidateFlashcardBlockIDs(request.BlockIDs); err != nil {
		return flashcardv2.AdvancedSourceResult{}, err
	}
	if request.Mode == flashcardv2.AdvancedModeImageOcclusion && request.ImageConfig != nil &&
		len(request.BlockIDs) == 1 {
		dom := GetBlockDOM(request.BlockIDs[0])
		assetID := request.ImageConfig.AssetID
		if dom == "" || (!strings.Contains(dom, assetID) && !strings.Contains(dom, html.EscapeString(assetID))) {
			return flashcardv2.AdvancedSourceResult{}, errors.New("image occlusion asset does not belong to the source block")
		}
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.AdvancedSourceResult{}, err
	}
	return store.CreateAdvancedSource(ctx, request)
}

// UpdateFlashcardV2BasicDirection 切换普通问答卡源的生成方向。
func UpdateFlashcardV2BasicDirection(ctx context.Context,
	request flashcardv2.BasicDirectionRequest) (flashcardv2.BasicSourceResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.BasicSourceResult{}, err
	}
	if err = validateFlashcardV2Source(ctx, store, request.SourceID); err != nil {
		return flashcardv2.BasicSourceResult{}, err
	}
	return store.UpdateBasicSourceDirection(ctx, request)
}

func validateFlashcardV2Source(ctx context.Context, store *flashcardv2.Store, sourceID string) error {
	revision, found, err := store.Projection().CurrentEntity(ctx, flashcardv2.EntityCardSource, sourceID)
	if err != nil || !found || revision.Deleted {
		if err != nil {
			return err
		}
		return flashcardv2.ErrEntityNotFound
	}
	var source flashcardv2.CardSource
	if err = json.Unmarshal(revision.Payload, &source); err != nil {
		return err
	}
	references, err := store.Projection().CardSourceReferences(ctx, source.ID)
	if err != nil {
		return err
	}
	primaryFound := false
	blockIDs := make([]string, 0, len(references))
	for _, reference := range references {
		if reference.ID == source.PrimaryRefID {
			primaryFound = true
		}
		if reference.EntityType == "block" {
			blockIDs = append(blockIDs, reference.EntityID)
		}
	}
	if !primaryFound {
		return errors.New("flashcard source primary reference was not found")
	}
	if source.Status == "orphaned" {
		return nil
	}
	return ValidateFlashcardBlockIDs(blockIDs)
}

// StartFlashcardV2Session 启动复习集或临时查询会话。
func StartFlashcardV2Session(ctx context.Context,
	request flashcardv2.StudyQueueRequest) (flashcardv2.StudyQueueResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.StudyQueueResult{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, true); err != nil {
		return flashcardv2.StudyQueueResult{}, err
	}
	request.ValidateCardIDs = func(validationContext context.Context, cardIDs []string) error {
		return validateFlashcardV2CardIDs(validationContext, store, cardIDs)
	}
	request.ValidateBlockIDs = ValidateFlashcardBlockIDs
	return store.StartStudySession(ctx, request)
}

// GetFlashcardV2SessionQueue 返回会话冻结顺序和当前状态。
func GetFlashcardV2SessionQueue(ctx context.Context, sessionID string) ([]flashcardv2.SessionQueueCard, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		return nil, err
	}
	queue, err := store.Projection().SessionQueue(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	cardIDs := make([]string, 0, len(queue))
	for index := range queue {
		if queue[index].Card.GenerationStatus == flashcardv2.GenerationActive {
			cardIDs = append(cardIDs, queue[index].Card.ID)
		}
	}
	if err = validateFlashcardV2CardIDs(ctx, store, cardIDs); err != nil {
		return nil, err
	}
	return queue, nil
}

// ReviewFlashcardV2Card 提交一次正式或强化复习。
func ReviewFlashcardV2Card(ctx context.Context,
	request flashcardv2.ReviewRequest) (flashcardv2.ReviewResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.ReviewResult{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, true); err != nil {
		return flashcardv2.ReviewResult{}, err
	}
	if err = validateFlashcardV2Card(ctx, store, request.CardID); err != nil {
		return flashcardv2.ReviewResult{}, err
	}
	return store.ReviewCard(ctx, request)
}

// UndoFlashcardV2Review 追加补偿记录并恢复一次复习产生的当前状态。
func UndoFlashcardV2Review(ctx context.Context,
	request flashcardv2.ReviewUndoRequest) (flashcardv2.ReviewUndoResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.ReviewUndoResult{}, err
	}
	if err = validateFlashcardV2Card(ctx, store, request.CardID); err != nil {
		return flashcardv2.ReviewUndoResult{}, err
	}
	return store.UndoReview(ctx, request)
}

// ManageFlashcardV2Cards 批量执行带审计记录的单卡管理操作。
func ManageFlashcardV2Cards(ctx context.Context,
	request flashcardv2.CardManagementRequest) (flashcardv2.CardManagementResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.CardManagementResult{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, true); err != nil {
		return flashcardv2.CardManagementResult{}, err
	}
	for _, cardID := range request.CardIDs {
		if err = validateFlashcardV2Card(ctx, store, cardID); err != nil {
			return flashcardv2.CardManagementResult{}, err
		}
	}
	return store.ManageCards(ctx, request)
}

// SetFlashcardV2TagAssignments 原子替换一组卡源或卡片的独立闪卡标签。
func SetFlashcardV2TagAssignments(ctx context.Context,
	request flashcardv2.SetTagAssignmentsRequest) (flashcardv2.SetTagAssignmentsResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.SetTagAssignmentsResult{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, true); err != nil {
		return flashcardv2.SetTagAssignmentsResult{}, err
	}
	if request.TargetType == "card" {
		if err = validateFlashcardV2CardIDs(ctx, store, request.TargetIDs); err != nil {
			return flashcardv2.SetTagAssignmentsResult{}, err
		}
	} else if request.TargetType == "source" {
		for _, sourceID := range request.TargetIDs {
			if err = validateFlashcardV2Source(ctx, store, sourceID); err != nil {
				return flashcardv2.SetTagAssignmentsResult{}, err
			}
		}
	}
	return store.SetTagAssignments(ctx, request)
}

// SetFlashcardV2ReviewSetMemberships 原子设置复习集的手动纳入或排除关系。
func SetFlashcardV2ReviewSetMemberships(ctx context.Context,
	request flashcardv2.SetReviewSetMembershipsRequest) (flashcardv2.SetReviewSetMembershipsResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.SetReviewSetMembershipsResult{}, err
	}
	if err = validateFlashcardV2CardIDs(ctx, store, request.CardIDs); err != nil {
		return flashcardv2.SetReviewSetMembershipsResult{}, err
	}
	return store.SetReviewSetMemberships(ctx, request)
}

// SaveFlashcardV2Tag 创建、重命名或移动独立闪卡标签。
func SaveFlashcardV2Tag(ctx context.Context,
	request flashcardv2.SaveTagRequest) (flashcardv2.EntityRevision, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.EntityRevision{}, err
	}
	return store.SaveTag(ctx, request)
}

// GetFlashcardV2StudyPolicy 按文档或笔记本范围返回当前策略。
func GetFlashcardV2StudyPolicy(ctx context.Context, scopeType,
	scopeID string) (flashcardv2.EntityRevision, bool, error) {
	if err := validateFlashcardV2StudyPolicyScope(scopeType, scopeID); err != nil {
		return flashcardv2.EntityRevision{}, false, err
	}
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.EntityRevision{}, false, err
	}
	return store.Projection().StudyPolicyRevision(ctx, scopeType, scopeID)
}

// SaveFlashcardV2StudyPolicy 创建或更新文档、笔记本范围学习策略。
func SaveFlashcardV2StudyPolicy(ctx context.Context,
	request flashcardv2.SaveStudyPolicyRequest) (flashcardv2.EntityRevision, error) {
	if err := validateFlashcardV2StudyPolicyScope(request.ScopeType, request.ScopeID); err != nil {
		return flashcardv2.EntityRevision{}, err
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.EntityRevision{}, err
	}
	return store.SaveStudyPolicy(ctx, request)
}

func validateFlashcardV2Card(ctx context.Context, store *flashcardv2.Store, cardID string) error {
	cardRevision, found, err := store.Projection().CurrentEntity(ctx, flashcardv2.EntityCard, cardID)
	if err != nil || !found || cardRevision.Deleted {
		if err != nil {
			return err
		}
		return flashcardv2.ErrEntityNotFound
	}
	var card flashcardv2.Card
	if err = json.Unmarshal(cardRevision.Payload, &card); err != nil {
		return err
	}
	if card.GenerationStatus != flashcardv2.GenerationActive {
		return nil
	}
	return validateFlashcardV2Source(ctx, store, card.SourceID)
}

func validateFlashcardV2CardIDs(ctx context.Context, store *flashcardv2.Store, cardIDs []string) error {
	validatedSources := map[string]struct{}{}
	for _, cardID := range cardIDs {
		cardRevision, found, err := store.Projection().CurrentEntity(ctx, flashcardv2.EntityCard, cardID)
		if err != nil || !found || cardRevision.Deleted {
			if err != nil {
				return err
			}
			return flashcardv2.ErrEntityNotFound
		}
		var card flashcardv2.Card
		if err = json.Unmarshal(cardRevision.Payload, &card); err != nil {
			return err
		}
		if card.GenerationStatus != flashcardv2.GenerationActive {
			continue
		}
		if _, validated := validatedSources[card.SourceID]; validated {
			continue
		}
		if err = validateFlashcardV2Source(ctx, store, card.SourceID); err != nil {
			return err
		}
		validatedSources[card.SourceID] = struct{}{}
	}
	return nil
}

func validateFlashcardV2SearchResults(ctx context.Context, store *flashcardv2.Store,
	results []flashcardv2.CardSearchResult) error {
	cardIDs := make([]string, 0, len(results))
	for index := range results {
		if results[index].Card.GenerationStatus == flashcardv2.GenerationActive {
			cardIDs = append(cardIDs, results[index].Card.ID)
		}
	}
	return validateFlashcardV2CardIDs(ctx, store, cardIDs)
}

// UpdateFlashcardV2SessionCard 更新会话跳过或展示状态。
func UpdateFlashcardV2SessionCard(ctx context.Context,
	request flashcardv2.SessionCardUpdateRequest) (flashcardv2.SessionCard, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.SessionCard{}, err
	}
	if err = validateFlashcardV2Card(ctx, store, request.CardID); err != nil {
		return flashcardv2.SessionCard{}, err
	}
	return store.UpdateSessionCard(ctx, request)
}

// FinishFlashcardV2Session 完成或放弃会话。
func FinishFlashcardV2Session(ctx context.Context,
	request flashcardv2.FinishSessionRequest) (flashcardv2.StudySession, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.StudySession{}, err
	}
	return store.FinishStudySession(ctx, request)
}

// GetFlashcardV2History 返回单卡完整评分与管理历史。
func GetFlashcardV2History(ctx context.Context, cardID string, limit, offset int) ([]flashcardv2.Event, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, err
	}
	if err = validateFlashcardV2Card(ctx, store, cardID); err != nil {
		return nil, err
	}
	return store.Projection().CardHistory(ctx, cardID, limit, offset)
}

// GetFlashcardV2Statistics 返回全局、复习集、查询或指定卡片范围的统计。
func GetFlashcardV2Statistics(ctx context.Context,
	request flashcardv2.StatisticsRequest) (flashcardv2.StatisticsResult, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.StatisticsResult{}, err
	}
	if err = refreshFlashcardV2BlockMetadata(ctx, store, false); err != nil {
		return flashcardv2.StatisticsResult{}, err
	}
	results, err := flashcardV2StatisticsScope(ctx, store, request)
	if err != nil {
		return flashcardv2.StatisticsResult{}, err
	}
	if err = validateFlashcardV2SearchResults(ctx, store, results); err != nil {
		return flashcardv2.StatisticsResult{}, err
	}
	return store.Projection().Statistics(ctx, request)
}

func flashcardV2StatisticsScope(ctx context.Context, store *flashcardv2.Store,
	request flashcardv2.StatisticsRequest) ([]flashcardv2.CardSearchResult, error) {
	options := flashcardv2.CardSearchOptions{Now: request.Now, IncludeInactive: true, IncludeSuspended: true,
		IncludeBuried: true, IncludePaused: true}
	results, err := store.Projection().SearchCards(ctx, request.Query, options)
	if err != nil {
		return nil, err
	}
	requested := map[string]struct{}{}
	if request.ReviewSetID != "" {
		cardIDs, setErr := store.Projection().ReviewSetCardIDs(ctx, request.ReviewSetID, options)
		if setErr != nil {
			return nil, setErr
		}
		for _, cardID := range cardIDs {
			requested[cardID] = struct{}{}
		}
	} else if len(request.CardIDs) != 0 {
		for _, cardID := range request.CardIDs {
			requested[cardID] = struct{}{}
		}
	} else {
		return results, nil
	}
	filtered := results[:0]
	for _, result := range results {
		if _, included := requested[result.Card.ID]; included {
			filtered = append(filtered, result)
		}
	}
	return filtered, nil
}

// DeleteFlashcardV2ReviewSet 删除复习集及其静态成员关系，但保留共享卡片和历史。
func DeleteFlashcardV2ReviewSet(ctx context.Context, operationID, reviewSetID, expectedRevisionID string,
	deletedAt int64) (flashcardv2.EntityMutationResult, error) {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.EntityMutationResult{}, err
	}
	return store.DeleteReviewSet(ctx, operationID, reviewSetID, expectedRevisionID, deletedAt)
}

// GetFlashcardV2RenderModel 返回卡片声明式渲染所需的模板和内容引用。
func GetFlashcardV2RenderModel(ctx context.Context, cardID string) (flashcardv2.CardRenderModel, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.CardRenderModel{}, err
	}
	if err = validateFlashcardV2Card(ctx, store, cardID); err != nil {
		return flashcardv2.CardRenderModel{}, err
	}
	return store.Projection().CardRenderModel(ctx, cardID)
}
