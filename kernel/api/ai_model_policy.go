// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"strings"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func aiRouteUnavailable(path string) bool {
	if !apicontract.RequiresAI(path) {
		return false
	}
	if util.IsDisabledFeature("ai") {
		return true
	}
	switch util.CurrentAIModelPolicy() {
	case util.AIModelsUnavailable:
		return true
	case util.AIModelsDeepSeek:
		switch path {
		case "/api/setting/setAI", "/api/ai/lsCapabilities", "/api/ai/chatGPT", "/api/ai/chatGPTWithAction":
			return false
		}
		return !strings.HasPrefix(path, "/api/ai/editor/") && !strings.HasPrefix(path, "/api/ai/agent/")
	}
	return false
}
