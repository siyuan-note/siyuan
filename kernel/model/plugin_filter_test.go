// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupPetalFilterTest(t *testing.T) func(string, bool, map[string]any) {
	t.Helper()
	originalConf, originalDataDir, originalContainer := Conf, util.DataDir, util.Container
	originalStart, originalStop := OnKernelPluginStart, OnKernelPluginStop
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	Conf.Bazaar.Store(&conf.Bazaar{Trust: true})
	Conf.Lang = "en"
	util.DataDir = testutil.PublicDataDir(t)
	util.Container = util.ContainerStd
	OnKernelPluginStart, OnKernelPluginStop = nil, nil
	t.Cleanup(func() {
		Conf, util.DataDir, util.Container = originalConf, originalDataDir, originalContainer
		OnKernelPluginStart, OnKernelPluginStop = originalStart, originalStop
	})
	return func(name string, enabled bool, fields map[string]any) {
		t.Helper()
		dir := filepath.Join(util.DataDir, "plugins", name)
		if err := os.MkdirAll(filepath.Join(dir, "i18n"), 0755); err != nil {
			t.Fatal(err)
		}
		manifest := map[string]any{"name": name, "version": "1.0.0", "minAppVersion": "0.0.1", "frontends": []string{"desktop"}, "kernels": []string{"all"}}
		for key, value := range fields {
			manifest[key] = value
		}
		data, err := json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		for path, content := range map[string]string{
			"plugin.json": string(data), "index.js": "frontend:" + name,
			"kernel.js": "private:" + name, "index.css": "/* " + name + " */",
			"i18n/en.json": `{"label":"` + name + `"}`,
		} {
			if err := os.WriteFile(filepath.Join(dir, path), []byte(content), 0644); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := SetPetalEnabled(name, enabled); err != nil {
			t.Fatal(err)
		}
	}
}

func petalFilterNames(petals []*Petal) []string {
	ret := make([]string, 0, len(petals))
	for _, petal := range petals {
		ret = append(ret, petal.Name)
	}
	slices.Sort(ret)
	return ret
}

func requireFilteredPetals(t *testing.T, petals []*Petal, names ...string) {
	t.Helper()
	if petals == nil || !slices.Equal(petalFilterNames(petals), names) {
		t.Fatalf("loaded %v, want %v (nil=%v)", petalFilterNames(petals), names, petals == nil)
	}
}

func TestNormalizePetalNames(t *testing.T) {
	if normalizePetalNames(nil) != nil {
		t.Fatal("nil must retain the all-plugins meaning")
	}
	if got := normalizePetalNames([]string{}); got == nil || len(got) != 0 {
		t.Fatalf("empty selection became all plugins: %#v", got)
	}
	input := []string{"beta", "alpha", "beta", "", "../alpha", " alpha"}
	before := slices.Clone(input)
	got := normalizePetalNames(input)
	want := []string{"", " alpha", "../alpha", "alpha", "beta"}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(input, before) {
		t.Fatalf("normalization changed input or exact names: got %q, input %q", got, input)
	}
	got[0] = "mutated"
	if !reflect.DeepEqual(input, before) {
		t.Fatal("normalized names share caller-owned storage")
	}
}

func TestLoadPetalsKeyIsolation(t *testing.T) {
	if loadPetalsKey("desktop", false, normalizePetalNames([]string{"beta", "alpha", "alpha"})) !=
		loadPetalsKey("desktop", false, normalizePetalNames([]string{"alpha", "beta"})) {
		t.Fatal("equivalent selections do not share a flight key")
	}
	seen := map[string]bool{}
	for _, item := range []struct {
		frontend string
		publish  bool
		names    []string
	}{
		{"desktop", false, nil}, {"desktop", false, []string{}},
		{"desktop", false, []string{"alpha"}}, {"desktop", false, []string{"beta"}},
		{"desktop", true, []string{"alpha"}}, {"mobile", false, []string{"alpha"}},
		{"desktop", false, []string{"alpha,beta"}}, {"desktop", false, []string{"alpha", "beta"}},
		{"desktop", false, []string{`alpha\"`, "beta:"}},
	} {
		key := loadPetalsKey(item.frontend, item.publish, item.names)
		if seen[key] {
			t.Fatalf("different requests share flight key %q", key)
		}
		seen[key] = true
	}
}

func TestLoadPetalsNamesSelection(t *testing.T) {
	install := setupPetalFilterTest(t)
	install("alpha", true, map[string]any{"settingsWindow": true})
	install("beta", true, nil)
	install("disabled", false, nil)
	install("mobile", true, map[string]any{"frontends": []string{"mobile"}})
	for _, item := range []struct {
		name        string
		names, want []string
	}{
		{"omitted", nil, []string{"alpha", "beta"}},
		{"empty", []string{}, nil},
		{"selected", []string{"alpha"}, []string{"alpha"}},
		{"duplicates", []string{"beta", "alpha", "alpha"}, []string{"alpha", "beta"}},
		{"unknown", []string{"missing"}, nil},
		{"disabled", []string{"disabled"}, nil},
		{"incompatible", []string{"mobile"}, nil},
		{"exact names", []string{"", "Alpha", " alpha", "alpha ", "../alpha", "alpha/", `..\alpha`, "/alpha", "alpha\x00"}, nil},
		{"mixed", []string{"missing", "../beta", "alpha"}, []string{"alpha"}},
	} {
		t.Run(item.name, func(t *testing.T) {
			requireFilteredPetals(t, LoadPetals("desktop", false, item.names), item.want...)
		})
	}
	selected := LoadPetals("desktop", false, []string{"alpha"})
	if selected[0].JS != "frontend:alpha" || selected[0].CSS != "/* alpha */" || selected[0].I18n["label"] != "alpha" {
		t.Fatalf("selected resources missing: %+v", selected[0])
	}
	requireFilteredPetals(t, LoadSettingsWindowPetals("desktop", false, []string{"beta"}))
	requireFilteredPetals(t, LoadSettingsWindowPetals("desktop", false, []string{}))
	settings := LoadSettingsWindowPetals("desktop", false, []string{"alpha", "beta", "alpha"})
	requireFilteredPetals(t, settings, "alpha")
	if !settings[0].SettingsWindow {
		t.Fatal("settings opt-in proof missing")
	}
	Conf.Bazaar.Load().Trust = false
	requireFilteredPetals(t, LoadPetals("desktop", false, []string{"alpha"}))
	Conf.Bazaar.Load().Trust = true
	Conf.Bazaar.Load().PetalDisabled = true
	requireFilteredPetals(t, LoadPetals("desktop", false, []string{"alpha"}))
}

func TestLoadPetalsNamesRefresh(t *testing.T) {
	install := setupPetalFilterTest(t)
	install("alpha", true, nil)
	names := []string{"alpha"}
	requireFilteredPetals(t, LoadPetals("desktop", false, names), "alpha")
	if _, err := SetPetalEnabled("alpha", false); err != nil {
		t.Fatal(err)
	}
	requireFilteredPetals(t, LoadPetals("desktop", false, names))
	if _, err := SetPetalEnabled("alpha", true); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, "plugins", "alpha", "index.js"), []byte("updated"), 0644); err != nil {
		t.Fatal(err)
	}
	got := LoadPetals("desktop", false, names)
	requireFilteredPetals(t, got, "alpha")
	if got[0].JS != "updated" {
		t.Fatal("reload reused stale code")
	}
	if err := os.RemoveAll(filepath.Join(util.DataDir, "plugins", "alpha")); err != nil {
		t.Fatal(err)
	}
	requireFilteredPetals(t, LoadPetals("desktop", false, names))
	install("alpha", false, nil)
	requireFilteredPetals(t, LoadPetals("desktop", false, names))
}

func TestLoadPetalsNamesPublish(t *testing.T) {
	install := setupPetalFilterTest(t)
	install("alpha", true, map[string]any{"settingsWindow": true})
	install("blocked", true, map[string]any{"disabledInPublish": true})
	install("private", true, nil)
	if _, err := SetPetalPublishEnabled("private", false); err != nil {
		t.Fatal(err)
	}
	names := []string{"alpha", "blocked", "private"}
	requireFilteredPetals(t, LoadPetals("desktop", false, names), "alpha", "blocked", "private")
	for _, got := range [][]*Petal{LoadPetals("desktop", true, names), LoadSettingsWindowPetals("desktop", true, names)} {
		requireFilteredPetals(t, got, "alpha")
		if got[0].JS != "frontend:alpha" || got[0].Kernel.JS != "" || got[0].Kernel.Existed {
			t.Fatalf("publish leaked kernel code or lost client code: %+v", got[0])
		}
	}
}

func TestLoadPetalsNamesConcurrent(t *testing.T) {
	install := setupPetalFilterTest(t)
	install("alpha", true, nil)
	install("beta", true, nil)
	requests := []struct{ names, want []string }{
		{nil, []string{"alpha", "beta"}}, {[]string{}, nil},
		{[]string{"alpha"}, []string{"alpha"}}, {[]string{"beta"}, []string{"beta"}},
		{[]string{"beta", "alpha", "alpha"}, []string{"alpha", "beta"}},
	}
	start := make(chan struct{})
	errors := make(chan string, 100)
	var workers sync.WaitGroup
	for i := 0; i < 100; i++ {
		request := requests[i%len(requests)]
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			got := LoadPetals("desktop", false, request.names)
			if got == nil || !slices.Equal(petalFilterNames(got), request.want) {
				errors <- fmt.Sprintf("names=%#v loaded %v, want %v", request.names, petalFilterNames(got), request.want)
			}
		}()
	}
	close(start)
	workers.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
}

func TestLoadPetalsNamesSkipUnselectedManifest(t *testing.T) {
	install := setupPetalFilterTest(t)
	install("alpha", true, nil)
	install("future", true, nil)
	manifest := `{"name":"future","version":"1.0.0","minAppVersion":"9999.0.0"}`
	if err := os.WriteFile(filepath.Join(util.DataDir, "plugins", "future", "plugin.json"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	requireFilteredPetals(t, LoadPetals("desktop", false, []string{}))
	requireFilteredPetals(t, LoadPetals("desktop", false, []string{"alpha"}), "alpha")
	if petal := GetPetalByName("future"); petal == nil || !petal.Enabled {
		t.Fatal("loading a selection processed and disabled an unrelated plugin")
	}
	requireFilteredPetals(t, LoadPetals("desktop", false, []string{"future"}))
	if petal := GetPetalByName("future"); petal == nil || petal.Enabled {
		t.Fatal("selected plugin bypassed required app version admission")
	}
}
