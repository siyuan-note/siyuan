// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type appearanceRuntimeState struct {
	pending map[string]bool
	blocked map[string]bool
	err     error
}

// newAppearanceRuntimeState 在外观锁内一次性读取恢复状态，无法认证时保留本机选择并暂缓加载第三方包。
func newAppearanceRuntimeState() *appearanceRuntimeState {
	ret := &appearanceRuntimeState{pending: map[string]bool{}, blocked: map[string]bool{}}
	keys, err := bazaar.PendingAppearancePackages()
	if err == nil {
		for _, key := range keys {
			ret.pending[key] = true
		}
		var exists bool
		exists, err = assetDownloadStateExists()
		if err == nil && exists {
			if Conf == nil || Conf.Repo == nil || len(Conf.Repo.Key) == 0 {
				err = fmt.Errorf("appearance recovery state cannot be authenticated without repository key")
			} else {
				keys, err = dejavu.ReadPendingAppearancePackages(assetDownloadStatePath(), Conf.Repo.Key)
				for _, key := range keys {
					ret.pending[key] = true
				}
			}
		}
	}
	ret.err = err
	if err != nil {
		logging.LogWarnf("read appearance recovery state failed: %s", err)
	}
	return ret
}

func (state *appearanceRuntimeState) preserveSelection(kind, name string) bool {
	key := "/" + kind + "/" + name
	return state.err != nil || state.pending[key] || state.blocked[key]
}

func (state *appearanceRuntimeState) validate(kind, name string) (err error) {
	key := "/" + kind + "/" + name
	defer func() {
		if err != nil && !errors.Is(err, bazaar.ErrAppearancePackageDeleted) {
			state.blocked[key] = true
		}
	}()
	if state.err != nil {
		return state.err
	}
	if state.pending[key] {
		// 待恢复包必须仍与已记录的完整版本一致，缺少记录时不能按本地开发包放行。
		if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "bazaar", kind, name+".json")); err != nil {
			return err
		}
		return bazaar.ValidateAppearancePackage(kind, name)
	}
	return bazaar.ValidateAppearancePackageForUse(kind, name)
}
