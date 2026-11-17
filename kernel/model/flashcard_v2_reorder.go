// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"path/filepath"
)

type FlashcardV2ReorderSourceRequest struct {
	flashcardv2.ReorderAdvancedSourceRequest
	ContentFingerprint string `json:"contentFingerprint"`
}

// ReorderFlashcardV2AdvancedSource 只调整顺序，不写正文或激活旧数据迁移。
func ReorderFlashcardV2AdvancedSource(ctx context.Context, request FlashcardV2ReorderSourceRequest) (flashcardv2.ReorderAdvancedSourceResult, error) {
	if err := request.Validate(); err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	if decoded, err := hex.DecodeString(request.ContentFingerprint); err != nil || len(decoded) != 32 {
		return flashcardv2.ReorderAdvancedSourceResult{}, errors.New("ordered content fingerprint is required")
	}
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	if err = validateFlashcardV2Source(ctx, store, request.SourceID); err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	references, err := store.Projection().CardSourceReferences(ctx, request.SourceID)
	if err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	blockIDs := make([]string, 0, len(references))
	for _, reference := range references {
		if reference.EntityType == "block" {
			blockIDs = append(blockIDs, reference.EntityID)
		}
	}
	// 排序也不能绕过已关闭或加密笔记本边界，包括 orphaned 卡源。
	if err = validateFlashcardV2ReorderBlocks(blockIDs); err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	return applyFlashcardV2ReorderWithFingerprint(ctx, request, store.ReplayReorderAdvancedSource,
		func(ctx context.Context) (FlashcardV2OrderedSourceDetails, error) {
			return readFlashcardV2OrderedDetails(ctx, request.SourceID, store.OrderedSourceSnapshot, readFlashcardV2DraftDOMs)
		}, store.ReorderAdvancedSource)
}

// applyFlashcardV2ReorderWithFingerprint 由调用方先执行当前访问权限校验。
func applyFlashcardV2ReorderWithFingerprint(ctx context.Context, request FlashcardV2ReorderSourceRequest,
	replay func(context.Context, flashcardv2.ReorderAdvancedSourceRequest) (flashcardv2.ReorderAdvancedSourceResult, bool, error),
	readDetails func(context.Context) (FlashcardV2OrderedSourceDetails, error),
	apply func(context.Context, flashcardv2.ReorderAdvancedSourceRequest) (flashcardv2.ReorderAdvancedSourceResult, error)) (flashcardv2.ReorderAdvancedSourceResult, error) {
	// 已成功的操作先重放，但仍须通过上面的当前来源访问校验。
	if result, found, replayErr := replay(ctx, request.ReorderAdvancedSourceRequest); replayErr != nil || found {
		return result, replayErr
	}
	details, err := readDetails(ctx)
	if err != nil {
		return flashcardv2.ReorderAdvancedSourceResult{}, err
	}
	if details.SourceRevision.RevisionID != request.ExpectedRevisionID {
		return flashcardv2.ReorderAdvancedSourceResult{}, flashcardv2.ErrRevisionConflict
	}
	if details.ContentFingerprint != request.ContentFingerprint {
		return flashcardv2.ReorderAdvancedSourceResult{}, errors.New("ordered source content changed; reload before saving")
	}
	return apply(ctx, request.ReorderAdvancedSourceRequest)
}

// validateFlashcardV2ReorderBlocks 不仅依赖可能尚未刷新的块索引，也检查笔记本配置。
func validateFlashcardV2ReorderBlocks(blockIDs []string) error {
	if len(blockIDs) == 0 || len(blockIDs) > 1000 {
		return errors.New("ordered source requires 1 to 1000 blocks")
	}
	checked := map[string]bool{}
	for _, id := range blockIDs {
		bt := treenode.GetBlockTreeInExactBox(id, "")
		if bt == nil || IsEncryptedBox(bt.BoxID) {
			return errors.New("ordered source requires existing unencrypted blocks")
		}
		if checked[bt.BoxID] {
			continue
		}
		data, err := filelock.ReadFile(filepath.Join(util.DataDir, bt.BoxID, ".siyuan", "conf.json"))
		if err != nil {
			return err
		}
		var box conf.BoxConf
		if err = json.Unmarshal(data, &box); err != nil || box.Closed || box.Encrypted || box.BoxCrypt != nil {
			return errors.New("ordered source requires open unencrypted notebooks")
		}
		checked[bt.BoxID] = true
	}
	return nil
}
