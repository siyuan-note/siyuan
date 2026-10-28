// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"bytes"
	"fmt"

	"github.com/open-spaced-repetition/go-fsrs/v3"
)

type Flashcard struct {
	NewCardLimit    int  `json:"newCardLimit"`    // 新卡上限 https://github.com/siyuan-note/siyuan/issues/7695
	ReviewCardLimit int  `json:"reviewCardLimit"` // 复习卡上限 https://github.com/siyuan-note/siyuan/issues/7703
	Mark            bool `json:"mark"`            // 是否启用标记制卡 https://github.com/siyuan-note/siyuan/issues/7794
	List            bool `json:"list"`            // 是否启用列表块制卡 https://github.com/siyuan-note/siyuan/issues/7701
	Blockquote      bool `json:"blockquote"`      // 是否启用引述块制卡 https://github.com/siyuan-note/siyuan/issues/11728
	Callout         bool `json:"callout"`         // 是否启用提示块制卡 https://github.com/siyuan-note/siyuan/issues/18333
	SuperBlock      bool `json:"superBlock"`      // 是否启用超级块制卡 https://github.com/siyuan-note/siyuan/issues/7702
	Heading         bool `json:"heading"`         // 是否启用标题块制卡 https://github.com/siyuan-note/siyuan/issues/9005
	Deck            bool `json:"deck"`            // 是否启用卡包制卡 https://github.com/siyuan-note/siyuan/issues/7724
	ReviewMode      int  `json:"reviewMode"`      // 复习模式，0：新旧混合，1：新卡优先，2：旧卡优先 https://github.com/siyuan-note/siyuan/issues/10303

	// Apply result optimized by FSRS optimizer https://github.com/siyuan-note/siyuan/issues/9309
	RequestRetention float64 `json:"requestRetention"`
	MaximumInterval  int     `json:"maximumInterval"`
	Weights          string  `json:"weights"`
}

func NewFlashcard() *Flashcard {
	param := fsrs.DefaultParam()
	return &Flashcard{
		NewCardLimit:     20,
		ReviewCardLimit:  200,
		Mark:             true,
		List:             true,
		Blockquote:       true,
		Callout:          true,
		SuperBlock:       true,
		Heading:          true,
		Deck:             false,
		ReviewMode:       0,
		RequestRetention: param.RequestRetention,
		MaximumInterval:  int(param.MaximumInterval),
		Weights:          DefaultFSRSWeights(),
	}
}

func DefaultFSRSWeights() string {
	buf := bytes.Buffer{}
	defaultWs := fsrs.DefaultWeights()
	for i, w := range defaultWs {
		fmt.Fprintf(&buf, "%v", w)
		if i < len(defaultWs)-1 {
			buf.WriteString(", ")
		}
	}
	return buf.String()
}
