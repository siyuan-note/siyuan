// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// FlashcardV2AdvancedPreviewRequest 保留草稿来源及挖空标识，不接受写入、排期或卡包参数。
type FlashcardV2AdvancedPreviewRequest struct {
	SourceID             string                               `json:"sourceID"`
	Mode                 string                               `json:"mode"`
	BlockIDs             []string                             `json:"blockIDs"`
	ClozeGroups          []FlashcardV2AdvancedClozeGroup      `json:"clozeGroups,omitempty" api:"optional"`
	InlineOcclusions     []FlashcardV2AdvancedInlineOcclusion `json:"inlineOcclusions,omitempty" api:"optional"`
	ImageConfig          *FlashcardV2ImageOcclusionConfig     `json:"imageConfig,omitempty" api:"optional,nullable"`
	CorrectOptionIndexes []int                                `json:"correctOptionIndexes,omitempty" api:"optional"`
	RandomizeOptions     bool                                 `json:"randomizeOptions" api:"optional"`
	TypedConfig          *FlashcardV2TypedAnswerConfig        `json:"typedConfig,omitempty" api:"optional,nullable"`
	DistractorQuery      *FlashcardV2QueryAST                 `json:"distractorQuery,omitempty" api:"optional,nullable"`
	DynamicDistractors   int                                  `json:"dynamicDistractors,omitempty" api:"optional"`
}

type FlashcardV2AdvancedPreviewData struct {
	Models []FlashcardV2CardRenderModel `json:"models"`
	DOMs   map[string]string            `json:"doms"`
}
