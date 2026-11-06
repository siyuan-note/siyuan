// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var deferredAssetsForEffects = model.DeferredSyncAssets

// EffectsWithSyncAssets 合并按需附件、历史分块和快照准备可能产生的下载效果。
// 未开启同步时远程缺失分块的下载会被访问检查拒绝，本地分块仍可物化为文件。
// 配置不可读时保留潜在外发和费用。
func EffectsWithSyncAssets(effects ToolEffects) ToolEffects {
	effects.LocalWrite = true
	var config *conf.Sync
	if model.Conf != nil {
		config = model.Conf.Sync.Load()
		if config != nil && !config.Enabled {
			return effects
		}
	}
	if config == nil || config.Provider != conf.ProviderLocal {
		effects.DataEgress, effects.ExternalCost = true, true
	} else if config.LAN != nil && config.LAN.Enabled {
		effects.DataEgress = true
	}
	return effects
}

func deferredAssetEffects(actions map[string]ToolEffects) func(string) (ToolEffects, bool) {
	return func(action string) (ToolEffects, bool) {
		effects, declared := actions[action]
		if !declared {
			return ToolEffects{}, false
		}
		// 逻辑清单仅读取本地元数据；没有待补资源时，读取现有附件不需要创建快照。
		if model.Conf != nil {
			pending, err := deferredAssetsForEffects()
			if err == nil && len(pending) == 0 {
				return effects, true
			}
		}
		return EffectsWithSyncAssets(effects), true
	}
}

func syncAssetEffects(actions map[string]ToolEffects) func(string) (ToolEffects, bool) {
	return func(action string) (ToolEffects, bool) {
		effects, declared := actions[action]
		if !declared {
			return ToolEffects{}, false
		}
		return EffectsWithSyncAssets(effects), true
	}
}
