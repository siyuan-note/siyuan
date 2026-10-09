package model

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLoadSettingsWindowPetals(t *testing.T) {
	originalConf, originalDataDir := Conf, util.DataDir
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	Conf.Bazaar = &conf.Bazaar{Trust: true}
	util.DataDir = t.TempDir()
	t.Cleanup(func() { Conf, util.DataDir = originalConf, originalDataDir })
	for _, item := range []struct {
		name, declaration, frontend string
		enabled                     bool
	}{
		{"opted", `,"settingsWindow":true`, "desktop", true},
		{"legacy", "", "desktop", true},
		{"rejected", `,"settingsWindow":false`, "desktop", true},
		{"disabled", `,"settingsWindow":true`, "desktop", false},
		{"incompatible", `,"settingsWindow":true`, "browser-desktop", true},
	} {
		dir := filepath.Join(util.DataDir, "plugins", item.name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		manifest := fmt.Sprintf(`{"name":%q,"version":"1.0.0","minAppVersion":"0.0.1","frontends":[%q]%s}`, item.name, item.frontend, item.declaration)
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("module.exports = class {};"), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := SetPetalEnabled(item.name, item.enabled); err != nil {
			t.Fatal(err)
		}
	}
	if ordinary := LoadPetals("desktop", false); len(ordinary) != 3 {
		t.Fatalf("ordinary loading changed: %+v", ordinary)
	}
	selected := LoadSettingsWindowPetals("desktop", false)
	if len(selected) != 1 || selected[0].Name != "opted" || !selected[0].SettingsWindow {
		t.Fatalf("unexpected settings plugins: %+v", selected)
	}
	if ordinary := LoadPetals("desktop", false); len(ordinary) != 3 {
		t.Fatal("settings loading changed ordinary loading")
	}
	Conf.Bazaar.PetalDisabled = true
	if len(LoadSettingsWindowPetals("desktop", false)) != 0 {
		t.Fatal("globally disabled plugins loaded")
	}
	Conf.Bazaar.PetalDisabled, Conf.Bazaar.Trust = false, false
	if util.Container == util.ContainerStd || util.Container == util.ContainerDocker {
		if len(LoadSettingsWindowPetals("desktop", false)) != 0 {
			t.Fatal("untrusted plugins loaded")
		}
	}
}
