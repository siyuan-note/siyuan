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
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/riff"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	legacyFlashcardV2SkipMu sync.Mutex
	legacyFlashcardV2Skips  = map[string]struct{}{}
)

// UseFlashcardV2Compatibility 报告旧 riff API 是否必须改用 V2 适配器。
func UseFlashcardV2Compatibility(ctx context.Context) (bool, error) {
	status, err := GetFlashcardV2MigrationStatus(ctx)
	if err != nil {
		return false, err
	}
	return status.State == flashcardv2.MigrationStateActive ||
		status.State == flashcardv2.MigrationStateLegacyDiverged, nil
}

// GetLegacyFlashcardV2Blocks 返回旧管理接口能够表示的单块快速卡。
func GetLegacyFlashcardV2Blocks(ctx context.Context, deckID string, blockIDs []string, page, pageSize int) (
	[]*Block, int, int, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, 0, 0, err
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, deckID)
	if err != nil {
		return nil, 0, 0, err
	}
	if len(blockIDs) != 0 {
		requested := make(map[string]struct{}, len(blockIDs))
		for _, blockID := range blockIDs {
			requested[blockID] = struct{}{}
		}
		filtered := cards[:0]
		for _, card := range cards {
			if _, found := requested[card.BlockID]; found {
				filtered = append(filtered, card)
			}
		}
		cards = filtered
	}
	if page < 1 || pageSize < 1 {
		return nil, 0, 0, errors.New("legacy flashcard page is invalid")
	}
	total := len(cards)
	pageCount := int(math.Ceil(float64(total) / float64(pageSize)))
	start := min((page-1)*pageSize, total)
	end := min(page*pageSize, total)
	return legacyFlashcardV2Blocks(cards[start:end]), total, pageCount, nil
}

// GetLegacyFlashcardV2BlocksByIDs 按调用方顺序返回块，并保留找不到内容时的占位项。
func GetLegacyFlashcardV2BlocksByIDs(ctx context.Context, blockIDs []string) ([]*Block, error) {
	blocks, _, _, err := GetLegacyFlashcardV2Blocks(ctx, builtinDeckID, blockIDs, 1, math.MaxInt)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*Block, len(blocks))
	for _, block := range blocks {
		byID[block.ID] = block
	}
	ret := make([]*Block, 0, len(blockIDs))
	for _, blockID := range blockIDs {
		if block := byID[blockID]; block != nil {
			ret = append(ret, block)
		} else {
			ret = append(ret, &Block{ID: blockID, Content: Conf.Language(180)})
		}
	}
	return ret, nil
}

// GetLegacyNotebookFlashcardV2Blocks 返回普通笔记本中的兼容快速卡。
func GetLegacyNotebookFlashcardV2Blocks(ctx context.Context, boxID string, page, pageSize int) (
	[]*Block, int, int, error) {
	if IsEncryptedBox(boxID) {
		return nil, 0, 0, errors.New(Conf.Language(313))
	}
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, 0, 0, err
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, builtinDeckID)
	if err != nil {
		return nil, 0, 0, err
	}
	filtered := cards[:0]
	for _, card := range cards {
		blockTree := treenode.GetBlockTreeInExactBox(card.BlockID, boxID)
		if blockTree != nil {
			filtered = append(filtered, card)
		}
	}
	return paginateLegacyFlashcardV2Cards(filtered, page, pageSize)
}

// GetLegacyTreeFlashcardV2Blocks 返回文档树中的兼容快速卡。
func GetLegacyTreeFlashcardV2Blocks(ctx context.Context, rootID string, page, pageSize int) (
	[]*Block, int, int, error) {
	if err := validateFlashcardTree(rootID); err != nil {
		return nil, 0, 0, err
	}
	treeBlocks, _ := getTreeBlocks(rootID)
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, 0, 0, err
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, builtinDeckID)
	if err != nil {
		return nil, 0, 0, err
	}
	filtered := cards[:0]
	for _, card := range cards {
		if treeBlocks[card.BlockID] {
			filtered = append(filtered, card)
		}
	}
	return paginateLegacyFlashcardV2Cards(filtered, page, pageSize)
}

func paginateLegacyFlashcardV2Cards(cards []flashcardv2.LegacyQuickCard, page, pageSize int) (
	[]*Block, int, int, error) {
	if page < 1 || pageSize < 1 {
		return nil, 0, 0, errors.New("legacy flashcard page is invalid")
	}
	total := len(cards)
	pageCount := int(math.Ceil(float64(total) / float64(pageSize)))
	start := min((page-1)*pageSize, total)
	end := min(page*pageSize, total)
	return legacyFlashcardV2Blocks(cards[start:end]), total, pageCount, nil
}

func legacyFlashcardV2Blocks(cards []flashcardv2.LegacyQuickCard) []*Block {
	if len(cards) == 0 {
		return []*Block{}
	}
	blockIDs := make([]string, 0, len(cards))
	for _, card := range cards {
		blockIDs = append(blockIDs, card.BlockID)
	}
	sqlBlocks := sql.GetBlocks(blockIDs)
	blocks := fromSQLBlocks(&sqlBlocks, "", 36)
	for index := range cards {
		if index >= len(blocks) || blocks[index] == nil {
			placeholder := &Block{ID: cards[index].BlockID, Content: Conf.Language(180)}
			if index >= len(blocks) {
				blocks = append(blocks, placeholder)
			} else {
				blocks[index] = placeholder
			}
		}
		blocks[index].RiffCardID = cards[index].Card.ID
		blocks[index].RiffCard = legacyFlashcardV2RiffCard(cards[index].ReviewState.ReviewStateSnapshot)
	}
	return blocks
}

func legacyFlashcardV2RiffCard(state flashcardv2.ReviewStateSnapshot) *RiffCard {
	due := time.UnixMilli(state.Due)
	if state.Due == 0 {
		due = time.Now()
	}
	return &RiffCard{Due: due, Reps: state.Reps, Lapses: state.Lapses,
		State: legacyFlashcardV2FSRSState(state.State), LastReview: time.UnixMilli(state.LastReview)}
}

func legacyFlashcardV2FSRSState(state string) fsrs.State {
	switch state {
	case "learning":
		return fsrs.Learning
	case "review":
		return fsrs.Review
	case "relearning":
		return fsrs.Relearning
	default:
		return fsrs.New
	}
}

// SetLegacyFlashcardV2DueTimes 执行旧批量改期接口，但只修改 V2 排期状态。
func SetLegacyFlashcardV2DueTimes(ctx context.Context, cardDues []*SetFlashcardDueTime) error {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return err
	}
	grouped := map[int64][]string{}
	for _, cardDue := range cardDues {
		if cardDue == nil {
			continue
		}
		card, found, resolveErr := store.Projection().ResolveLegacyCard(ctx, builtinDeckID, cardDue.ID)
		if resolveErr != nil {
			return resolveErr
		}
		if !found {
			continue
		}
		if err = ValidateFlashcardBlockIDs([]string{card.BlockID}); err != nil {
			return err
		}
		due, parseErr := time.ParseInLocation("20060102150405", cardDue.Due, time.Local)
		if parseErr != nil {
			return parseErr
		}
		grouped[due.UnixMilli()] = append(grouped[due.UnixMilli()], card.Card.ID)
	}
	now := time.Now().UnixMilli()
	for due, cardIDs := range grouped {
		_, err = store.ManageCards(ctx, flashcardv2.CardManagementRequest{OperationID: flashcardv2.NewID(),
			CardIDs: cardIDs, Action: flashcardv2.CardActionSetDue, ChangedAt: now, Due: due})
		if err != nil {
			return err
		}
	}
	return nil
}

// ResetLegacyFlashcardV2Cards 重置旧接口所选范围内的 V2 排期。
func ResetLegacyFlashcardV2Cards(ctx context.Context, typ, id, deckID string, blockIDs []string) error {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return err
	}
	if err = ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return err
	}
	if typ == "notebook" && IsEncryptedBox(id) {
		return errors.New(Conf.Language(313))
	}
	if typ == "tree" {
		if err = validateFlashcardTree(id); err != nil {
			return err
		}
	}
	scopeDeckID := deckID
	if scopeDeckID == "" && typ == "deck" {
		scopeDeckID = id
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, scopeDeckID)
	if err != nil {
		return err
	}
	requested := make(map[string]struct{}, len(blockIDs))
	for _, blockID := range blockIDs {
		requested[blockID] = struct{}{}
	}
	var treeBlocks map[string]bool
	if typ == "tree" && len(blockIDs) == 0 {
		treeBlocks, _ = getTreeBlocks(id)
	}
	cardIDs := make([]string, 0)
	for _, card := range cards {
		selected := len(requested) == 0
		if len(requested) != 0 {
			_, selected = requested[card.BlockID]
		} else if typ == "notebook" {
			blockTree := treenode.GetBlockTree(card.BlockID)
			selected = blockTree != nil && blockTree.BoxID == id
		} else if typ == "tree" {
			selected = treeBlocks[card.BlockID]
		}
		if selected {
			cardIDs = append(cardIDs, card.Card.ID)
		}
	}
	if len(cardIDs) == 0 {
		return nil
	}
	_, err = store.ManageCards(ctx, flashcardv2.CardManagementRequest{OperationID: flashcardv2.NewID(),
		CardIDs: cardIDs, Action: flashcardv2.CardActionReset, ChangedAt: time.Now().UnixMilli()})
	return err
}

// AddLegacyFlashcardV2Cards 通过旧入口创建 V2 单块快速卡。
func AddLegacyFlashcardV2Cards(ctx context.Context, deckID string, blockIDs []string) (
	flashcardv2.LegacyReviewSetInfo, error) {
	if err := ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return flashcardv2.LegacyReviewSetInfo{}, err
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.LegacyReviewSetInfo{}, err
	}
	if _, err = store.AddLegacyQuickCards(ctx, flashcardv2.NewID(), deckID, blockIDs,
		time.Now().UnixMilli()); err != nil {
		return flashcardv2.LegacyReviewSetInfo{}, err
	}
	return getLegacyFlashcardV2ReviewSet(ctx, store, deckID)
}

// RemoveLegacyFlashcardV2Cards 通过旧入口移除 V2 单块快速卡。
func RemoveLegacyFlashcardV2Cards(ctx context.Context, deckID string, blockIDs []string) (
	*flashcardv2.LegacyReviewSetInfo, error) {
	if err := ValidateFlashcardBlockIDs(blockIDs); err != nil {
		return nil, err
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return nil, err
	}
	if err = store.RemoveLegacyQuickCards(ctx, flashcardv2.NewID(), deckID, blockIDs,
		time.Now().UnixMilli()); err != nil {
		return nil, err
	}
	if deckID == "" {
		return nil, nil
	}
	info, err := getLegacyFlashcardV2ReviewSet(ctx, store, deckID)
	return &info, err
}

// GetLegacyFlashcardV2ReviewSets 返回旧卡包列表兼容数据。
func GetLegacyFlashcardV2ReviewSets(ctx context.Context) ([]flashcardv2.LegacyReviewSetInfo, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, err
	}
	sets, err := store.Projection().LegacyReviewSets(ctx)
	if err != nil {
		return nil, err
	}
	ret := sets[:0]
	for _, set := range sets {
		if set.DeckID != builtinDeckID {
			ret = append(ret, set)
		}
	}
	return ret, nil
}

// CreateLegacyFlashcardV2ReviewSet 创建旧卡包 API 对应的 V2 复习集。
func CreateLegacyFlashcardV2ReviewSet(ctx context.Context, deckID, name string) (
	flashcardv2.LegacyReviewSetInfo, error) {
	if deckID == "" {
		deckID = ast.NewNodeID()
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.LegacyReviewSetInfo{}, err
	}
	return store.CreateLegacyReviewSet(ctx, flashcardv2.NewID(), deckID, name, time.Now().UnixMilli(),
		Conf.Flashcard.NewCardLimit, Conf.Flashcard.ReviewCardLimit)
}

// GetLegacyNotebookFlashcardV2DueCards 返回普通笔记本范围内的旧接口队列。
func GetLegacyNotebookFlashcardV2DueCards(ctx context.Context, boxID string, reviewedCardIDs []string) (
	[]*Flashcard, int, int, int, error) {
	if IsEncryptedBox(boxID) {
		return nil, 0, 0, 0, errors.New(Conf.Language(313))
	}
	return GetLegacyFlashcardV2DueCards(ctx, builtinDeckID, reviewedCardIDs, func(blockID string) bool {
		return treenode.GetBlockTreeInExactBox(blockID, boxID) != nil
	})
}

// GetLegacyTreeFlashcardV2DueCards 返回文档树范围内的旧接口队列。
func GetLegacyTreeFlashcardV2DueCards(ctx context.Context, rootID string, reviewedCardIDs []string) (
	[]*Flashcard, int, int, int, error) {
	if err := validateFlashcardTree(rootID); err != nil {
		return nil, 0, 0, 0, err
	}
	treeBlocks, _ := getTreeBlocks(rootID)
	return GetLegacyFlashcardV2DueCards(ctx, builtinDeckID, reviewedCardIDs, func(blockID string) bool {
		return treeBlocks[blockID]
	})
}

// RenameLegacyFlashcardV2ReviewSet 修改旧卡包 API 对应的 V2 复习集名称。
func RenameLegacyFlashcardV2ReviewSet(ctx context.Context, deckID, name string) error {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return err
	}
	return store.RenameLegacyReviewSet(ctx, flashcardv2.NewID(), deckID, name, time.Now().UnixMilli())
}

// RemoveLegacyFlashcardV2ReviewSet 删除旧卡包 API 对应的 V2 复习集。
func RemoveLegacyFlashcardV2ReviewSet(ctx context.Context, deckID string) error {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return err
	}
	return store.RemoveLegacyReviewSet(ctx, flashcardv2.NewID(), deckID, time.Now().UnixMilli())
}

func getLegacyFlashcardV2ReviewSet(ctx context.Context, store *flashcardv2.Store,
	deckID string) (flashcardv2.LegacyReviewSetInfo, error) {
	sets, err := store.Projection().LegacyReviewSets(ctx)
	if err != nil {
		return flashcardv2.LegacyReviewSetInfo{}, err
	}
	for _, set := range sets {
		if set.DeckID == deckID {
			return set, nil
		}
	}
	return flashcardv2.LegacyReviewSetInfo{}, flashcardv2.ErrEntityNotFound
}

// GetLegacyFlashcardV2DueCards 返回旧复习界面需要的 V2 队列数据。
func GetLegacyFlashcardV2DueCards(ctx context.Context, deckID string, reviewedCardIDs []string,
	blockFilter func(string) bool) ([]*Flashcard, int, int, int, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	if deckID == "" {
		deckID = builtinDeckID
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, deckID)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	reviewed := map[string]struct{}{}
	for _, cardID := range reviewedCardIDs {
		card, found, resolveErr := store.Projection().ResolveLegacyCard(ctx, deckID, cardID)
		if resolveErr != nil {
			return nil, 0, 0, 0, resolveErr
		}
		if found {
			reviewed[card.Card.ID] = struct{}{}
		}
	}
	legacyFlashcardV2SkipMu.Lock()
	if len(reviewedCardIDs) == 0 {
		legacyFlashcardV2Skips = map[string]struct{}{}
	}
	skipped := make(map[string]struct{}, len(legacyFlashcardV2Skips))
	for cardID := range legacyFlashcardV2Skips {
		skipped[cardID] = struct{}{}
	}
	legacyFlashcardV2SkipMu.Unlock()
	now := time.Now()
	var dueNew, dueOld []flashcardv2.LegacyQuickCard
	unreviewedCount, unreviewedNew, unreviewedOld := 0, 0, 0
	for _, card := range cards {
		if blockFilter != nil && !blockFilter(card.BlockID) || !isSupportedFlashcardBlock(card.BlockID) ||
			card.ReviewState.Suspended || card.ReviewState.BuriedUntil > now.UnixMilli() ||
			card.ReviewState.Due > now.UnixMilli() || legacyFlashcardV2Priority(card) == "paused" {
			continue
		}
		if _, found := skipped[card.Card.ID]; found {
			continue
		}
		if _, found := reviewed[card.Card.ID]; !found {
			unreviewedCount++
			if card.ReviewState.State == "new" {
				unreviewedNew++
			} else {
				unreviewedOld++
			}
		}
		if card.ReviewState.State == "new" {
			dueNew = append(dueNew, card)
		} else {
			dueOld = append(dueOld, card)
		}
	}
	if len(dueNew) > Conf.Flashcard.NewCardLimit {
		dueNew = dueNew[:Conf.Flashcard.NewCardLimit]
	}
	if len(dueOld) > Conf.Flashcard.ReviewCardLimit {
		dueOld = dueOld[:Conf.Flashcard.ReviewCardLimit]
	}
	selected := append([]flashcardv2.LegacyQuickCard(nil), dueNew...)
	selected = append(selected, dueOld...)
	if Conf.Flashcard.ReviewMode == 2 {
		selected = append([]flashcardv2.LegacyQuickCard(nil), dueOld...)
		selected = append(selected, dueNew...)
	} else if Conf.Flashcard.ReviewMode == 0 {
		sort.SliceStable(selected, func(i, j int) bool {
			if selected[i].ReviewState.Due == selected[j].ReviewState.Due {
				return selected[i].Card.ID < selected[j].Card.ID
			}
			return selected[i].ReviewState.Due < selected[j].ReviewState.Due
		})
	}
	ret := make([]*Flashcard, 0, len(selected))
	for _, card := range selected {
		nextDues, previewErr := store.PreviewReviewDues(ctx, card.Card.ID, now.UnixMilli())
		if previewErr != nil {
			return nil, 0, 0, 0, previewErr
		}
		formatted := map[riff.Rating]string{}
		for rating, due := range nextDues {
			formatted[legacyFlashcardV2RiffRating(rating)] = strings.TrimSpace(
				util.HumanizeDiffTime(time.UnixMilli(due), now, Conf.Lang))
		}
		ret = append(ret, &Flashcard{DeckID: deckID, CardID: card.Card.ID, BlockID: card.BlockID,
			Lapses: int(card.ReviewState.Lapses), Reps: int(card.ReviewState.Reps),
			State:      riff.State(legacyFlashcardV2FSRSState(card.ReviewState.State)),
			LastReview: card.ReviewState.LastReview, NextDues: formatted})
	}
	return ret, unreviewedCount, min(unreviewedNew, Conf.Flashcard.NewCardLimit),
		min(unreviewedOld, Conf.Flashcard.ReviewCardLimit), nil
}

func legacyFlashcardV2Priority(card flashcardv2.LegacyQuickCard) string {
	if card.Card.PriorityOverride != "" {
		return card.Card.PriorityOverride
	}
	return card.SourcePriority
}

func legacyFlashcardV2RiffRating(rating flashcardv2.ReviewRating) riff.Rating {
	switch rating {
	case flashcardv2.ReviewHard:
		return riff.Hard
	case flashcardv2.ReviewGood:
		return riff.Good
	case flashcardv2.ReviewEasy:
		return riff.Easy
	default:
		return riff.Again
	}
}

// ReviewLegacyFlashcardV2Card 通过旧评分入口写入完整 V2 复习事件。
func ReviewLegacyFlashcardV2Card(ctx context.Context, deckID, cardID string, rating riff.Rating,
	durationMS int64) error {
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return err
	}
	if deckID == "" {
		deckID = builtinDeckID
	}
	card, found, err := store.Projection().ResolveLegacyCard(ctx, deckID, cardID)
	if err != nil {
		return err
	}
	if !found {
		return flashcardv2.ErrEntityNotFound
	}
	if err = ValidateFlashcardBlockIDs([]string{card.BlockID}); err != nil {
		return err
	}
	reviewRating, err := legacyFlashcardV2ReviewRating(rating)
	if err != nil {
		return err
	}
	now := time.Now()
	nextDay := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.Local).UnixMilli()
	_, err = store.ReviewCard(ctx, flashcardv2.ReviewRequest{OperationID: flashcardv2.NewID(),
		CardID: card.Card.ID, Rating: reviewRating, ReviewedAt: now.UnixMilli(), DurationMS: durationMS,
		ReviewSetID: flashcardv2.LegacyReviewSetID(deckID), ReviewMode: "normal", BuryUntil: nextDay})
	if err == nil {
		legacyFlashcardV2SkipMu.Lock()
		delete(legacyFlashcardV2Skips, card.Card.ID)
		legacyFlashcardV2SkipMu.Unlock()
	}
	return err
}

func legacyFlashcardV2ReviewRating(rating riff.Rating) (flashcardv2.ReviewRating, error) {
	switch rating {
	case riff.Again:
		return flashcardv2.ReviewAgain, nil
	case riff.Hard:
		return flashcardv2.ReviewHard, nil
	case riff.Good:
		return flashcardv2.ReviewGood, nil
	case riff.Easy:
		return flashcardv2.ReviewEasy, nil
	default:
		return "", fmt.Errorf("unsupported legacy flashcard rating [%d]", rating)
	}
}

// SkipLegacyFlashcardV2Card 在旧复习会话中临时跳过一张 V2 快速卡。
func SkipLegacyFlashcardV2Card(ctx context.Context, deckID, cardID string) error {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return err
	}
	if deckID == "" {
		deckID = builtinDeckID
	}
	card, found, err := store.Projection().ResolveLegacyCard(ctx, deckID, cardID)
	if err != nil {
		return err
	}
	if !found {
		return flashcardv2.ErrEntityNotFound
	}
	legacyFlashcardV2SkipMu.Lock()
	legacyFlashcardV2Skips[card.Card.ID] = struct{}{}
	legacyFlashcardV2SkipMu.Unlock()
	return nil
}
