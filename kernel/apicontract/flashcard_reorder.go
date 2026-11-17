// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// FlashcardV2ReorderAdvancedSourceRequest 仅提交已有步骤的完整排列，不增删步骤或更改引用。
type FlashcardV2ReorderAdvancedSourceRequest struct {
	ContentFingerprint string   `json:"contentFingerprint"`
	OperationID        string   `json:"operationID"`
	SourceID           string   `json:"sourceID"`
	ExpectedRevisionID string   `json:"expectedRevisionID"`
	OrderedStepIDs     []string `json:"orderedStepIDs"`
	UpdatedAt          int64    `json:"updatedAt"`
}

type FlashcardV2ReorderAdvancedSourceResult struct {
	SourceRevision FlashcardV2EntityRevision `json:"sourceRevision"`
	UpdatedCardIDs []string                  `json:"updatedCardIDs"`
	Batch          FlashcardV2OperationBatch `json:"batch"`
}

type FlashcardV2OrderedSourceDetailsRequest struct {
	SourceID string `json:"sourceID"`
}
type FlashcardV2OrderedSourceDetails struct {
	SourceRevision     FlashcardV2EntityRevision  `json:"sourceRevision"`
	References         []FlashcardV2CardSourceRef `json:"references"`
	DOMs               map[string]string          `json:"doms"`
	ContentFingerprint string                     `json:"contentFingerprint"`
}
