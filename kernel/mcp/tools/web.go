// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func webToolConfig() conf.AIWeb {
	ai := model.Conf.LoadAI()
	if ai != nil && ai.Web != nil {
		return *ai.Web
	}
	return conf.AIWeb{SearchProvider: "exa", FetchProvider: "direct", Timeout: 30}
}

func webToolEffects(provider string) (ToolEffects, bool) {
	if provider == "deepseek" {
		return ToolEffects{DataEgress: true, ExternalCost: true}, true
	}
	return ToolEffects{}, false
}
