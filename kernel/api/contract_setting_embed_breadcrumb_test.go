// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingEmbedBreadcrumbParentPath(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"embedBlockBreadcrumbParentPath":true}`, `{"embedBlockBreadcrumbParentPath":false}`,
		`{"embedBlockBreadcrumbParentPath":null}`, `{"EmbedBlockBreadcrumbParentPath":false}`, `{"embedBlockBreadcrumbParentPath":"bad"}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly = previousConf, previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{}`, true}, {`{"embedBlockBreadcrumbParentPath":false}`, false}, {`{}`, false},
		{`{"embedBlockBreadcrumbParentPath":null}`, true}, {`{"embedBlockBreadcrumbParentPath":true}`, true},
		{`{"EmbedBlockBreadcrumbParentPath":false}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		actual := model.Conf.Editor.Load().EmbedBlockBreadcrumbParentPath
		if code != 0 || actual == nil || *actual != entry.want || response.EmbedBlockBreadcrumbParentPath == nil || *response.EmbedBlockBreadcrumbParentPath != entry.want {
			t.Fatalf("breadcrumb setting %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
}
