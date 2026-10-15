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
	"encoding/json"
	"errors"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

// 配置段按快照更新：写入方在配置锁内复制当前段、在副本上修改并规范化后整体替换指针，
// 读方一次取得的段指针在其生命周期内不会被改写，因此同一段内多个字段的读取总是自洽的。

// cloneConfSection 通过 JSON 往返深复制配置段，配置段的全部状态均为可序列化的导出字段。
func cloneConfSection[T any](section *T) *T {
	if section == nil {
		return nil
	}
	data, err := json.Marshal(section)
	if err != nil {
		logging.LogErrorf("clone conf section failed: %s", err)
		return nil
	}
	ret := new(T)
	if err = json.Unmarshal(data, ret); err != nil {
		logging.LogErrorf("clone conf section failed: %s", err)
		return nil
	}
	return ret
}

// updateConfSection 使用指定配置段的提交规则更新当前快照，规范化后整体替换并持久化，返回替换后的段。
// mutate 返回 false 时放弃本次修改，不替换也不持久化。
func updateConfSection[T any](spec *SectionSpec[*T], mutate func(*T) bool) *T {
	spec.WriteLock.Lock()
	defer spec.WriteLock.Unlock()
	for {
		old := spec.Load()
		next := cloneConfSection(old)
		if next == nil {
			next = spec.Normalize(nil)
		}
		if !mutate(next) {
			return spec.Load()
		}
		if _, err := applySectionLockedAt(spec, next, old, true); err != nil {
			if errors.Is(err, errConfSectionChanged) {
				continue
			}
			logging.LogWarnf("update conf section [%s] failed: %s", spec.Namespace, err)
		}
		return spec.Load()
	}
}

func always[T any](mutate func(*T)) func(*T) bool {
	return func(section *T) bool {
		mutate(section)
		return true
	}
}

// UpdateSyncConf 以快照方式更新同步配置段。
func UpdateSyncConf(mutate func(*conf.Sync)) *conf.Sync {
	return updateConfSection(syncSectionSpec(), always(mutate))
}

// UpdateSystemConf 以快照方式更新系统配置段。
func UpdateSystemConf(mutate func(*conf.System)) *conf.System {
	return updateConfSection(systemSectionSpec(), always(mutate))
}

// UpdateRepoConf 以快照方式更新数据仓库配置段。
func UpdateRepoConf(mutate func(*conf.Repo)) *conf.Repo {
	return updateConfSection(repoSectionSpec(), always(mutate))
}

// UpdateEditorConf 以快照方式更新编辑器配置段。
func UpdateEditorConf(mutate func(*conf.Editor)) *conf.Editor {
	return updateConfSection(editorSectionSpec(), always(mutate))
}

// UpdateAppearanceConf 以快照方式更新外观配置段。
func UpdateAppearanceConf(mutate func(*conf.Appearance)) *conf.Appearance {
	return updateConfSection(appearanceSectionSpec(false), always(mutate))
}

// UpdateBazaarConf 以快照方式更新集市配置段。
func UpdateBazaarConf(mutate func(*conf.Bazaar)) *conf.Bazaar {
	return updateConfSection(bazaarSectionSpec(), always(mutate))
}

// UpdateGraphConf 以快照方式更新关系图配置段；mutate 返回 false 表示没有变化。
func UpdateGraphConf(mutate func(*conf.Graph) bool) *conf.Graph {
	return updateConfSection(graphSectionSpec(), mutate)
}

// UpdateTagConf 以快照方式更新标签面板配置段。
func UpdateTagConf(mutate func(*conf.Tag)) *conf.Tag {
	return updateConfSection(tagSectionSpec(), always(mutate))
}

// UpdateAPIConf 以快照方式更新 API 配置段。
func UpdateAPIConf(mutate func(*conf.API)) *conf.API {
	return updateConfSection(apiSectionSpec(), always(mutate))
}

// UpdatePublishConf 以快照方式更新发布服务配置段。
func UpdatePublishConf(mutate func(*conf.Publish)) *conf.Publish {
	return updateConfSection(publishSectionSpec(), always(mutate))
}

// UpdateOnboardingConf 以快照方式更新首次使用引导状态。
func UpdateOnboardingConf(mutate func(*conf.Onboarding)) *conf.Onboarding {
	return updateConfSection(onboardingSectionSpec(), always(mutate))
}

// UpdateStatConf 以快照方式更新统计配置段。
func UpdateStatConf(mutate func(*conf.Stat)) *conf.Stat {
	return updateConfSection(statSectionSpec(), always(mutate))
}

// replaceConfSectionLocked 要求调用方已持有配置锁：在 field 当前值的副本上执行 mutate 后整体替换，
// 不做规范化也不持久化。mutate 返回 false 时保持原段不变。
func replaceConfSectionLocked[T any](field *ConfSection[T], mutate func(*T) bool) bool {
	next := cloneConfSection(field.Load())
	if next == nil || !mutate(next) {
		return false
	}
	field.Store(next)
	return true
}
