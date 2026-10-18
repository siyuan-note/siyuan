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
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/eventbus"
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
	app.System.Store(&appconf.System{SafeMode: true})
	app.AI.Store(appconf.NewAI())
	app.AI.Load().Providers = []*appconf.Provider{{APIKey: "plain-api-key"}}
	app.AI.Load().Web.APIKey = "plain-web-key"
	app.Secrets.Store(&appconf.Secrets{Items: []*appconf.Secret{{Name: "token", Value: "plain-secret"}}})
	app.MCPOAuth = "encrypted-oauth-data"
	app.Save()

	if app.AI.Load().Web.APIKey != "plain-web-key" || app.AI.Load().Providers[0].APIKey != "plain-api-key" || app.Secrets.Load().Items[0].Value != "plain-secret" || !app.System.Load().SafeMode {
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
	if stored.AI.Load().Web.APIKey == "plain-web-key" || stored.AI.Load().Providers[0].APIKey == "plain-api-key" || stored.Secrets.Load().Items[0].Value == "plain-secret" || stored.System.Load().SafeMode {
		t.Fatalf("stored configuration was not sanitized: %#v", stored)
	}
	if stored.MCPOAuth != app.MCPOAuth {
		t.Fatalf("unexpected stored MCP OAuth data: %q", stored.MCPOAuth)
	}
}

func TestIndexStateEventsDoNotSaveConfiguration(t *testing.T) {
	oldConf, oldDir, oldReadOnly := Conf, util.ConfDir, util.ReadOnly
	Conf, util.ConfDir, util.ReadOnly = NewAppConf(), t.TempDir(), false
	t.Cleanup(func() { Conf, util.ConfDir, util.ReadOnly = oldConf, oldDir, oldReadOnly })
	file := filepath.Join(util.ConfDir, "conf.json")
	marker := []byte("configuration must not be serialized by index state events")
	if err := os.WriteFile(file, marker, 0600); err != nil {
		t.Fatal(err)
	}
	for _, state := range []int{1, 1, 0, 1, 0} {
		if state == 1 {
			eventbus.Publish(eventbus.EvtSQLIndexChanged)
		} else {
			eventbus.Publish(eventbus.EvtSQLIndexFlushed)
		}
		if Conf.DataIndexState != state {
			t.Fatalf("runtime state=%d, want %d", Conf.DataIndexState, state)
		}
		data, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(data, marker) {
			t.Fatalf("index event saved configuration: %v", err)
		}
	}
}

func TestGraphQuerySavesOnlyChangedConfiguration(t *testing.T) {
	oldConfDir, oldReadOnly := util.ConfDir, util.ReadOnly
	util.ConfDir, util.ReadOnly = t.TempDir(), false
	t.Cleanup(func() { util.ConfDir, util.ReadOnly = oldConfDir, oldReadOnly })
	app := NewAppConf()
	app.Graph.Store(appconf.NewGraph())
	global, local := app.Graph.Load().Global, app.Graph.Load().Local
	path := filepath.Join(util.ConfDir, "conf.json")
	marker := []byte("unchanged graph query must not serialize configuration")
	if err := os.WriteFile(path, marker, 0600); err != nil {
		t.Fatal(err)
	}
	app.SaveGraphQueryConf(appconf.NewGlobalGraph(), appconf.NewLocalGraph())
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, marker) || app.Graph.Load().Global != global || app.Graph.Load().Local != local {
		t.Fatalf("unchanged query saved or replaced configuration: %s, %v", data, err)
	}
	for _, globalQuery := range []bool{true, false} {
		if globalQuery {
			next := appconf.NewGlobalGraph()
			next.MinRefs = 7
			app.SaveGraphQueryConf(next, nil)
		} else {
			next := appconf.NewLocalGraph()
			next.DailyNote = true
			app.SaveGraphQueryConf(nil, next)
		}
		data, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		stored := NewAppConf()
		if err = gulu.JSON.UnmarshalJSON(data, stored); err != nil {
			t.Fatal(err)
		}
		if stored.Graph.Load().Global.MinRefs != 7 || stored.Graph.Load().Local.DailyNote != !globalQuery {
			t.Fatalf("graph change was not persisted: %+v", stored.Graph.Load())
		}
	}
}
