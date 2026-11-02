// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"html"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func repoCheckoutFailedBeforeApply(err error) bool {
	var checkoutErr *dejavu.CheckoutError
	return errors.As(err, &checkoutErr) && !checkoutErr.MayHaveApplied
}

// withRepoCheckoutSyncPaused 仅在恢复流程能证明没有改写文件时恢复原同步开关。
func withRepoCheckoutSyncPaused(repo *dejavu.Repo, checkout func() error) (err error) {
	_, changes, recoveryErr := repo.AssetDownloadChanges()
	_, pendingErr := repo.DeferredAssets()
	recoveryMayApply := recoveryErr != nil || pendingErr != nil || (changes != nil && changes.DataChanged())
	syncEnabled := Conf.Sync.Load().Enabled
	UpdateSyncConf(func(s *conf.Sync) { s.Enabled = false })
	pauseMessageID := ""
	if syncEnabled {
		pauseMessageID = util.PushMsg(Conf.Language(134), 0)
	}
	defer func() {
		if err == nil {
			return
		}
		paused := false
		if syncEnabled {
			if !recoveryMayApply && repoCheckoutFailedBeforeApply(err) {
				UpdateSyncConf(func(s *conf.Sync) { s.Enabled = true })
				util.PushClearMsg(pauseMessageID)
			} else {
				paused = true
			}
		}
		reportRepoCheckoutFailure(err, paused)
	}()
	return checkout()
}

func reportRepoCheckoutFailure(err error, paused bool) {
	logging.LogErrorf("checkout repository failed: %s", err)
	msg := Conf.Language(141) + ": " + html.EscapeString(err.Error())
	if paused {
		msg += "<br>" + Conf.Language(462)
	}
	util.PushClearProgress()
	util.PushErrMsg(msg, 0)
}
