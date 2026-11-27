// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"

	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
)

type FlashcardV2OrderedSourceDetails struct {
	SourceRevision     flashcardv2.EntityRevision  `json:"sourceRevision"`
	References         []flashcardv2.CardSourceRef `json:"references"`
	DOMs               map[string]string           `json:"doms"`
	ContentFingerprint string                      `json:"contentFingerprint"`
}

func GetFlashcardV2OrderedSourceDetails(ctx context.Context, sourceID string) (FlashcardV2OrderedSourceDetails, error) {
	if strings.TrimSpace(sourceID) == "" {
		return FlashcardV2OrderedSourceDetails{}, errors.New("ordered source ID is required")
	}
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	return readFlashcardV2OrderedDetails(ctx, sourceID, store.OrderedSourceSnapshot, readFlashcardV2DraftDOMs)
}

// readFlashcardV2OrderedDetails 拒绝混合修订与正文快照，指纹不包含内部文件路径。
func readFlashcardV2OrderedDetails(ctx context.Context, sourceID string,
	readSnapshot func(context.Context, string) (flashcardv2.OrderedSourceSnapshot, error),
	readDOMs func(context.Context, []string) (map[string]string, func() error, error)) (FlashcardV2OrderedSourceDetails, error) {
	before, err := readSnapshot(ctx, sourceID)
	if err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, ref := range before.References {
		if ref.EntityType != "block" {
			return FlashcardV2OrderedSourceDetails{}, errors.New("unsupported ordered reference")
		}
		if !seen[ref.EntityID] {
			seen[ref.EntityID] = true
			ids = append(ids, ref.EntityID)
		}
	}
	if len(ids) == 0 || len(ids) > 1000 {
		return FlashcardV2OrderedSourceDetails{}, errors.New("ordered source requires 1 to 1000 blocks")
	}
	doms, verify, err := readDOMs(ctx, ids)
	if err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	for _, id := range ids {
		if strings.TrimSpace(doms[id]) == "" {
			return FlashcardV2OrderedSourceDetails{}, errors.New("ordered source content is missing")
		}
	}
	after, err := readSnapshot(ctx, sourceID)
	if err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	if !reflect.DeepEqual(before, after) {
		return FlashcardV2OrderedSourceDetails{}, errors.New("ordered source changed while reading details")
	}
	if err = ctx.Err(); err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	if err = verify(); err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	result := FlashcardV2OrderedSourceDetails{SourceRevision: before.SourceRevision, References: before.References, DOMs: doms}
	encoded, err := flashcardv2.CanonicalJSON(result)
	if err != nil {
		return FlashcardV2OrderedSourceDetails{}, err
	}
	digest := sha256.Sum256(encoded)
	result.ContentFingerprint = hex.EncodeToString(digest[:])
	return result, nil
}
