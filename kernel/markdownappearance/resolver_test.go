// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package markdownappearance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type response struct {
	Preferences map[string]any `json:"preferences"`
	Appearance  Appearance     `json:"appearance"`
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T, platform string) (*Resolver, string, string, string) {
	t.Helper()
	root := t.TempDir()
	config := filepath.Join(root, "home", ".config", "siyuan", "markdown")
	workspace := filepath.Join(root, "workspace")
	writeJSON(t, filepath.Join(workspace, "conf", "conf.json"), map[string]any{"appearance": map[string]any{"mode": 1, "modeOS": false, "globalFontFamilies": []Font{{"System Sans", 400}}}, "editor": map[string]any{"fontSize": 23, "fontFamilies": []Font{{"Editor Serif", 500}}, "codeFontFamilies": []Font{{"Mono", 400}}}})
	writeJSON(t, filepath.Join(filepath.Dir(config), "workspace.json"), []string{workspace})
	r, err := New(config, root, platform)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r, root, workspace, digest([]byte("workspace"))
}

func resolve(t *testing.T, r *Resolver, prefs, patch string) response {
	t.Helper()
	raw, err := r.Resolve(prefs, patch)
	if err != nil {
		t.Fatal(err)
	}
	var ret response
	if err = json.Unmarshal([]byte(raw), &ret); err != nil {
		t.Fatal(err)
	}
	return ret
}

func encoded(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestIndependentDefaultsLegacyAndPatch(t *testing.T) {
	r, _, _, id := fixture(t, "android")
	ret := resolve(t, r, `{"mode":"sv","theme":"dark","fontSize":19,"nativeFlag":true}`, "")
	if ret.Appearance.Theme != "dark" || ret.Appearance.FontSize != 19 || ret.Preferences["mode"] != "sv" || ret.Preferences["nativeFlag"] != true {
		t.Fatalf("unexpected legacy: %+v", ret)
	}
	for _, group := range groups {
		if ret.Appearance.Sources[group] != "independent" {
			t.Fatal(ret.Appearance.Sources)
		}
	}
	ret = resolve(t, r, encoded(t, ret.Preferences), encoded(t, map[string]any{"sources": map[string]string{"theme": id, "fonts": id}, "independent": map[string]any{"fontSize": 21}}))
	if ret.Appearance.Theme != "dark" || ret.Appearance.FontSize != 21 || ret.Appearance.Fonts["editor"][0].Family != "Editor Serif" {
		t.Fatal(ret.Appearance)
	}
	ret = resolve(t, r, encoded(t, ret.Preferences), `{"sources":{"theme":"independent","fonts":"independent"}}`)
	if ret.Appearance.Theme != "dark" || ret.Appearance.FontSize != 21 || len(ret.Appearance.Fonts["editor"]) != 0 {
		t.Fatal(ret.Appearance)
	}
}

func TestMissingWorkspaceFallsBackPersistently(t *testing.T) {
	r, root, workspace, id := fixture(t, "android")
	prefs := `{"mode":"ir","sources":{"fontSize":"` + id + `"}}`
	ret := resolve(t, r, prefs, "")
	if ret.Appearance.FontSize != 23 {
		t.Fatal(ret.Appearance)
	}
	moved := filepath.Join(root, "moved")
	if err := os.Rename(workspace, moved); err != nil {
		t.Fatal(err)
	}
	ret = resolve(t, r, prefs, "")
	if ret.Appearance.Sources["fontSize"] != "independent" || ret.Appearance.FontSize != 16 {
		t.Fatal(ret.Appearance)
	}
	if err := os.Rename(moved, workspace); err != nil {
		t.Fatal(err)
	}
	ret = resolve(t, r, encoded(t, ret.Preferences), "")
	if ret.Appearance.FontSize != 16 {
		t.Fatal("restored workspace unexpectedly regained source")
	}
}

func TestIOSRelocationAndStableIDs(t *testing.T) {
	for _, platform := range []string{"ios", "android"} {
		t.Run(platform, func(t *testing.T) {
			r, root, _, id := fixture(t, platform)
			writeJSON(t, filepath.Join(root, "home", ".config", "siyuan", "workspace.json"), []string{"/private/var/mobile/Containers/Data/Application/OLD/Documents/workspace"})
			ret := resolve(t, r, `{"mode":"ir","sources":{"fontSize":"`+id+`"}}`, "")
			if platform == "ios" {
				if ret.Appearance.FontSize != 23 || len(ret.Appearance.Workspaces) != 1 || ret.Appearance.Workspaces[0].ID != id {
					t.Fatal(ret.Appearance)
				}
			} else if len(ret.Appearance.Workspaces) != 0 || ret.Appearance.FontSize != 16 {
				t.Fatal("non-iOS relocated an external path")
			}
		})
	}
	r1, _, _, id1 := fixture(t, "ios")
	r2, _, _, id2 := fixture(t, "ios")
	if id1 != id2 || resolve(t, r1, "", "").Appearance.Workspaces[0].ID != resolve(t, r2, "", "").Appearance.Workspaces[0].ID {
		t.Fatal("ID changed with sandbox root")
	}
}

func TestRegistryAndConfigurationBoundaries(t *testing.T) {
	r, root, workspace, id := fixture(t, "android")
	outside := t.TempDir()
	writeJSON(t, filepath.Join(outside, "conf.json"), map[string]any{"editor": map[string]int{"fontSize": 70}})
	conf := filepath.Join(workspace, "conf", "conf.json")
	if err := os.Remove(conf); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "conf.json"), conf); err != nil {
		t.Skip(err)
	}
	ret := resolve(t, r, `{"sources":{"fontSize":"`+id+`"}}`, "")
	if ret.Appearance.FontSize != 16 || ret.Appearance.Sources["fontSize"] != "independent" {
		t.Fatal(ret.Appearance)
	}
	registry := filepath.Join(root, "home", ".config", "siyuan", "workspace.json")
	if err := os.Remove(registry); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(outside, "workspace.json"), []string{workspace})
	if err := os.Symlink(filepath.Join(outside, "workspace.json"), registry); err != nil {
		t.Fatal(err)
	}
	if len(resolve(t, r, "", "").Appearance.Workspaces) != 0 {
		t.Fatal("symlink registry accepted")
	}
	if _, err := New(filepath.Join(outside, "markdown"), root, "android"); err == nil {
		t.Fatal("out-of-root config accepted")
	}
}

func TestMissingRegistryAndRootSymlink(t *testing.T) {
	root := t.TempDir()
	r, err := New(filepath.Join(root, "absent", "markdown"), root, "android")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if len(resolve(t, r, "", "").Appearance.Workspaces) != 0 {
		t.Fatal("unexpected workspaces")
	}
	if _, err = os.Stat(filepath.Join(root, "absent")); !os.IsNotExist(err) {
		t.Fatal("resolver created directory")
	}
	alias := filepath.Join(t.TempDir(), "root")
	if err = os.Symlink(root, alias); err != nil {
		t.Skip(err)
	}
	s, err := New(filepath.Join(alias, "absent", "markdown"), alias, "ios")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	resolve(t, s, "", "")
}

func fontFixture(t *testing.T) (*Resolver, string, string, string) {
	t.Helper()
	r, _, workspace, id := fixture(t, "android")
	data := []byte("\x00\x01\x00\x00test font payload")
	fontID := digest(data)
	fontPath := filepath.Join(workspace, "conf", "appearance", "fonts", "custom", fontID+".ttf")
	if err := os.MkdirAll(filepath.Dir(fontPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fontPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(workspace, "conf", "conf.json"), map[string]any{"editor": map[string]any{"fontFamilies": []Font{{customPrefix + fontID, 400}}}})
	ret := resolve(t, r, `{"sources":{"fonts":"`+id+`"}}`, "")
	if len(ret.Appearance.CustomFonts) != 1 {
		t.Fatal(ret.Appearance)
	}
	token := strings.TrimPrefix(ret.Appearance.CustomFonts[0].URL, "/appearance-font/")
	if len(token) != 48 {
		t.Fatal("invalid token length")
	}
	return r, fontPath, token, encoded(t, ret.Preferences)
}

func TestFontGrantReadRevokeAndClose(t *testing.T) {
	r, _, token, prefs := fontFixture(t)
	bytes, err := r.ReadFont(token)
	if err != nil || !strings.HasPrefix(string(bytes), "\x00\x01\x00\x00") {
		t.Fatal(err)
	}
	ret := resolve(t, r, prefs, "")
	if !strings.HasSuffix(ret.Appearance.CustomFonts[0].URL, token) {
		t.Fatal("stable selection replaced grant")
	}
	resolve(t, r, prefs, `{"sources":{"fonts":"independent"}}`)
	if _, err = r.ReadFont(token); err == nil {
		t.Fatal("revoked token worked")
	}
	r.Close()
	if _, err = r.Resolve("", ""); err == nil {
		t.Fatal("closed resolver worked")
	}
	if _, err = r.ReadFont(token); err == nil {
		t.Fatal("closed font worked")
	}
}

func TestFontRejectsTamperLinksAndLimits(t *testing.T) {
	for _, kind := range []string{"hash", "header", "symlink", "directorySymlink", "size", "budget"} {
		t.Run(kind, func(t *testing.T) {
			r, path, token, _ := fontFixture(t)
			switch kind {
			case "hash":
				os.WriteFile(path, []byte("\x00\x01\x00\x00tampered"), 0600)
			case "header":
				os.WriteFile(path, []byte("NOT A FONT"), 0600)
			case "symlink":
				data, _ := os.ReadFile(path)
				other := filepath.Join(t.TempDir(), "font.ttf")
				os.WriteFile(other, data, 0600)
				os.Remove(path)
				if err := os.Symlink(other, path); err != nil {
					t.Skip(err)
				}
			case "directorySymlink":
				dir := filepath.Dir(path)
				other := dir + "-real"
				if err := os.Rename(dir, other); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(other, dir); err != nil {
					t.Skip(err)
				}
			case "size":
				if err := os.Truncate(path, maxFontBytes+1); err != nil {
					t.Fatal(err)
				}
			case "budget":
				r.fontBytes["another-grant"] = maxSessionFontBytes
			}
			if _, err := r.ReadFont(token); err == nil {
				t.Fatalf("accepted %s", kind)
			}
		})
	}
}

func TestInvalidPatchAndConcurrentReads(t *testing.T) {
	r, _, token, prefs := fontFixture(t)
	for _, patch := range []string{`null`, `[]`, `{"sources":{"fonts":"../../secret"}}`, `{"sources":{"unknown":"independent"}}`, `{"independent":{"fontSize":100}}`, `{"independent":{"fonts":{"global":[],"editor":[],"code":[{"family":"SiYuanCustomFont-abc","weight":400}]}}}`, `{"unknown":true}`} {
		if _, err := r.Resolve(prefs, patch); err == nil {
			t.Fatalf("accepted patch: %s", patch)
		}
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.ReadFont(token); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
}

func TestConfigurationLimitsAndEscapingWorkspace(t *testing.T) {
	r, root, workspace, id := fixture(t, "android")
	conf := filepath.Join(workspace, "conf", "conf.json")
	if err := os.Truncate(conf, 4*1024*1024+1); err != nil {
		t.Fatal(err)
	}
	ret := resolve(t, r, `{"sources":{"fontSize":"`+id+`"}}`, "")
	if ret.Appearance.Sources["fontSize"] != "independent" {
		t.Fatal("oversize configuration accepted")
	}
	outside := t.TempDir()
	link := filepath.Join(root, "external")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip(err)
	}
	registry := filepath.Join(root, "home", ".config", "siyuan", "workspace.json")
	writeJSON(t, registry, []string{link, outside})
	if len(resolve(t, r, "", "").Appearance.Workspaces) != 0 {
		t.Fatal("external workspace accepted")
	}
	if err := os.Truncate(registry, 1024*1024+1); err != nil {
		t.Fatal(err)
	}
	if len(resolve(t, r, "", "").Appearance.Workspaces) != 0 {
		t.Fatal("oversize registry accepted")
	}
	if _, err := New(root, root, "android"); err == nil {
		t.Fatal("registry outside root accepted")
	}
}

func TestIndependentFontValidation(t *testing.T) {
	r, _, _, _ := fixture(t, "android")
	for _, family := range []string{"", "bad\nfont", strings.Repeat("a", 257), strings.Repeat("😀", 129), customPrefix + strings.Repeat("a", 64)} {
		patch := map[string]any{"independent": map[string]any{"fonts": map[string]any{"global": []Font{{family, 400}}, "editor": []Font{}, "code": []Font{}}}}
		if _, err := r.Resolve("", encoded(t, patch)); err == nil {
			t.Fatalf("accepted invalid font %q", family)
		}
	}
	valid := map[string]any{"independent": map[string]any{"fonts": map[string]any{"global": []Font{{"Valid Family", 500}}, "editor": []Font{}, "code": []Font{}}}}
	ret := resolve(t, r, "", encoded(t, valid))
	if ret.Appearance.Fonts["global"][0].Weight != 500 {
		t.Fatal(ret.Appearance)
	}
}

func TestInternalDirectorySymlinksRejected(t *testing.T) {
	for _, part := range []string{"workspace", "conf"} {
		t.Run(part, func(t *testing.T) {
			r, _, workspace, id := fixture(t, "android")
			path := workspace
			if part == "conf" {
				path = filepath.Join(path, "conf")
			}
			real := path + "-real"
			if err := os.Rename(path, real); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(real, path); err != nil {
				t.Skip(err)
			}
			ret := resolve(t, r, `{"sources":{"fontSize":"`+id+`"}}`, "")
			if ret.Appearance.Sources["fontSize"] != "independent" || ret.Appearance.FontSize != 16 {
				t.Fatal("internal symlink accepted", ret.Appearance)
			}
		})
	}
}

func TestNonObjectConfigurationFallsBack(t *testing.T) {
	for _, value := range []any{nil, []any{}, "invalid"} {
		t.Run(encoded(t, value), func(t *testing.T) {
			r, _, workspace, id := fixture(t, "android")
			writeJSON(t, filepath.Join(workspace, "conf", "conf.json"), value)
			ret := resolve(t, r, encoded(t, map[string]any{"sources": map[string]string{"theme": id, "fontSize": id, "fonts": id}}), "")
			for _, group := range groups {
				if ret.Appearance.Sources[group] != "independent" {
					t.Fatalf("invalid config retained %s source", group)
				}
			}
			saved, ok := ret.Preferences["sources"].(map[string]any)
			if !ok || saved["fonts"] != "independent" {
				t.Fatal("fallback not included in preferences")
			}
		})
	}
}
