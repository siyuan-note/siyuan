// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type FlashcardV2AdvancedPreview struct {
	Models []flashcardv2.CardRenderModel `json:"models"`
	DOMs   map[string]string             `json:"doms"`
}

// PreviewFlashcardV2AdvancedSource 读取独立源快照，不打开闪卡存储或触发旧格式迁移。
func PreviewFlashcardV2AdvancedSource(ctx context.Context, request flashcardv2.AdvancedSourceRequest) (FlashcardV2AdvancedPreview, error) {
	return previewFlashcardV2AdvancedSource(ctx, request, readFlashcardV2DraftDOMs)
}

func previewFlashcardV2AdvancedSource(ctx context.Context, request flashcardv2.AdvancedSourceRequest,
	readDOMs func(context.Context, []string) (map[string]string, func() error, error)) (FlashcardV2AdvancedPreview, error) {
	models, err := flashcardv2.PreviewAdvancedSource(request)
	if err != nil {
		return FlashcardV2AdvancedPreview{}, err
	}
	blockIDs := slices.Clone(request.BlockIDs)
	if request.Mode == flashcardv2.AdvancedModeImageOcclusion {
		for _, id := range request.ImageConfig.ExplanationBlockIDs() {
			if !slices.Contains(blockIDs, id) {
				blockIDs = append(blockIDs, id)
			}
		}
	}
	doms, verify, err := readDOMs(ctx, blockIDs)
	if err != nil {
		return FlashcardV2AdvancedPreview{}, err
	}
	if err = validateFlashcardV2AdvancedSourceDOM(request.BlockIDs, request.InlineOcclusions, request.Mode,
		request.ImageConfig, func(id string) string { return doms[id] }); err != nil {
		return FlashcardV2AdvancedPreview{}, err
	}
	if err = ctx.Err(); err != nil {
		return FlashcardV2AdvancedPreview{}, err
	}
	if err = verify(); err != nil {
		return FlashcardV2AdvancedPreview{}, err
	}
	return FlashcardV2AdvancedPreview{Models: models, DOMs: doms}, nil
}

func readFlashcardV2DraftDOMs(ctx context.Context, ids []string) (map[string]string, func() error, error) {
	doms := make(map[string]string, len(ids))
	fingerprints := map[string][sha256.Size]byte{}
	lute := util.NewLute()
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		bt := treenode.GetBlockTreeInExactBox(id, "")
		if bt == nil || IsEncryptedBox(bt.BoxID) {
			return nil, nil, errors.New("draft preview requires existing unencrypted blocks")
		}
		configPath := filepath.Join(util.DataDir, bt.BoxID, ".siyuan", "conf.json")
		configData, err := filelock.ReadFile(configPath)
		if err != nil {
			return nil, nil, err
		}
		var box conf.BoxConf
		if err = json.Unmarshal(configData, &box); err != nil || box.Closed || box.Encrypted || box.BoxCrypt != nil {
			return nil, nil, errors.New("draft preview requires an open unencrypted notebook")
		}
		configDigest := sha256.Sum256(configData)
		if previous, found := fingerprints[configPath]; found && previous != configDigest {
			return nil, nil, errors.New("draft notebook changed during preview")
		}
		fingerprints[configPath] = configDigest
		tree, digest, err := filesys.ReadTreeSnapshot(bt.BoxID, bt.Path)
		if err != nil {
			return nil, nil, err
		}
		node := treenode.GetNodeInTree(tree, id)
		if node == nil {
			return nil, nil, errors.New("draft source block is missing")
		}
		path := filepath.Join(util.DataDir, bt.BoxID, bt.Path)
		if previous, found := fingerprints[path]; found && previous != digest {
			return nil, nil, errors.New("draft source changed during preview")
		}
		fingerprints[path] = digest
		doms[id] = lute.RenderNodeBlockDOM(cleanRenderNode(node, false))
	}
	verify := func() error {
		for path, expected := range fingerprints {
			data, err := filelock.ReadFile(path)
			if err != nil {
				return err
			}
			if sha256.Sum256(data) != expected {
				return errors.New("draft source or notebook changed during preview")
			}
		}
		return nil
	}
	return doms, verify, nil
}
