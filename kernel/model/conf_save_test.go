// SiYuan - Refactor your thinking
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
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/gulu"
	appconf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSaveUsesEncryptedSnapshot(t *testing.T) {
	oldConfDir, oldReadOnly := util.ConfDir, util.ReadOnly
	util.ConfDir = t.TempDir()
	util.ReadOnly = false
	t.Cleanup(func() {
		util.ConfDir, util.ReadOnly = oldConfDir, oldReadOnly
	})

	app := NewAppConf()
	app.System = &appconf.System{SafeMode: true}
	app.AI = appconf.NewAI()
	app.AI.Providers = []*appconf.Provider{{APIKey: "plain-api-key"}}
	app.Secrets = &appconf.Secrets{Items: []*appconf.Secret{{Name: "token", Value: "plain-secret"}}}
	app.MCPOAuth = "encrypted-oauth-data"
	app.Save()

	if app.AI.Providers[0].APIKey != "plain-api-key" || app.Secrets.Items[0].Value != "plain-secret" || !app.System.SafeMode {
		t.Fatalf("live configuration was mutated: %#v", app)
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	stored := NewAppConf()
	if err = gulu.JSON.UnmarshalJSON(data, stored); err != nil {
		t.Fatal(err)
	}
	if stored.AI.Providers[0].APIKey == "plain-api-key" || stored.Secrets.Items[0].Value == "plain-secret" || stored.System.SafeMode {
		t.Fatalf("stored configuration was not sanitized: %#v", stored)
	}
	if stored.MCPOAuth != app.MCPOAuth {
		t.Fatalf("unexpected stored MCP OAuth data: %q", stored.MCPOAuth)
	}
}
