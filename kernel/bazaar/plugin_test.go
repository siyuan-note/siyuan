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

package bazaar

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseInstalledPluginRejectsNameMismatch(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	pluginDir := filepath.Join(util.DataDir, "plugins", "plugin-sample")
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(pluginDir, "plugin.json")
	if err := os.WriteFile(manifestPath, []byte(`{"name":"other","version":"1.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if found, _, _, _, _, _, _ := ParseInstalledPlugin("plugin-sample", ""); found {
		t.Fatal("expected a plugin with a mismatched name to be rejected")
	}

	if err := os.WriteFile(manifestPath, []byte(`{"name":"plugin-sample","version":"1.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if found, version, _, _, _, _, _ := ParseInstalledPlugin("plugin-sample", ""); !found || version != "1.0.0" {
		t.Fatalf("expected matching plugin to be found, found=%v version=%q", found, version)
	}
}
