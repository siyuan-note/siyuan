// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestSyncActionsReportUnavailableOperations(t *testing.T) {
	previous := model.Conf
	model.Conf = &model.AppConf{Lang: "en", Sync: model.NewConfSection(conf.NewSync())}
	model.Conf.Sync.Load().Enabled = false
	t.Cleanup(func() { model.Conf = previous })
	for _, action := range []string{"perform", "upload", "download"} {
		t.Run(action, func(t *testing.T) {
			result, err := syncHandler(map[string]any{"action": action})
			if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, "failed") {
				t.Fatalf("unavailable sync reported success: %+v, %v", result, err)
			}
		})
	}
}
