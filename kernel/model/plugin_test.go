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
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetPetalPublishEnabled(t *testing.T) {
	originalConf := Conf
	originalDataDir := util.DataDir
	Conf = NewAppConf()
	Conf.Bazaar = &conf.Bazaar{Trust: true}
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		Conf = originalConf
		util.DataDir = originalDataDir
	})

	pluginDir := filepath.Join(util.DataDir, "plugins", "example")
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","disabledInPublish":false,"kernels":["all"]}`)
	if err := os.WriteFile(filepath.Join(pluginDir, "plugin.json"), manifest, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "index.js"), []byte("export default class {}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "kernel.js"), []byte("export const onload = () => {}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "README.md"), []byte("example"), 0644); err != nil {
		t.Fatal(err)
	}

	if _, err := SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	if petal := GetPetalByName("example"); petal == nil || petal.UserDisabledInPublish {
		t.Fatal("plugin should be enabled in publish by default")
	}

	if _, err := SetPetalPublishEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	if petal := GetPetalByName("example"); petal == nil || !petal.UserDisabledInPublish {
		t.Fatal("plugin publish preference was not persisted")
	}
	packages := GetInstalledPackages("plugins", "", "")
	if len(packages) != 1 || packages[0].UserDisabledInPublish == nil || !*packages[0].UserDisabledInPublish {
		t.Fatal("installed plugin data should include the user publish preference")
	}
	if petals := LoadPetals("", false); len(petals) != 1 || petals[0].Name != "example" {
		t.Fatal("user publish preference should not disable the plugin outside publish")
	}
	if petals := LoadPetals("", true); len(petals) != 0 {
		t.Fatal("user-disabled plugin should not load in publish")
	}
	if petals := LoadKernelPetals(); len(petals) != 1 || petals[0].Name != "example" {
		t.Fatal("user publish preference should not disable the kernel plugin")
	}

	if _, err := SetPetalEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	if petal := GetPetalByName("example"); petal == nil || !petal.UserDisabledInPublish {
		t.Fatal("normal plugin state changes should preserve the publish preference")
	}
	if _, err := SetPetalPublishEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	if petal := GetPetalByName("example"); petal == nil || petal.UserDisabledInPublish {
		t.Fatal("plugin publish preference was not enabled")
	}
}

func TestIsPetalsEnabled(t *testing.T) {
	originalConf := Conf
	originalContainer := util.Container
	t.Cleanup(func() {
		Conf = originalConf
		util.Container = originalContainer
	})

	Conf = NewAppConf()
	Conf.Bazaar = conf.NewBazaar()
	Conf.Bazaar.PetalDisabled = false
	Conf.Bazaar.Trust = false

	for _, container := range []string{util.ContainerAndroid, util.ContainerIOS, util.ContainerHarmony} {
		util.Container = container
		if !IsPetalsEnabled() {
			t.Fatalf("petals should be enabled on mobile container [%s] without bazaar trust", container)
		}
	}

	for _, container := range []string{util.ContainerStd, util.ContainerDocker} {
		util.Container = container
		if IsPetalsEnabled() {
			t.Fatalf("petals should be disabled on container [%s] without bazaar trust", container)
		}
	}

	Conf.Bazaar.Trust = true
	if !IsPetalsEnabled() {
		t.Fatal("petals should be enabled after bazaar trust")
	}

	Conf.Bazaar.PetalDisabled = true
	if IsPetalsEnabled() {
		t.Fatal("petals should be disabled explicitly")
	}
}
