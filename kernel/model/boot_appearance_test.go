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
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetBootAppearances(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	originalLang := util.Lang
	util.Lang = "zh-CN"
	t.Cleanup(func() { util.Lang = originalLang })
	writeBootAppearanceTestPlugin(t, "provider-one", "sunrise", `{
		"schemaVersion": 1,
		"id": "sunrise",
		"displayName": {"default": "Sunrise", "zh_CN": "日出"},
		"backgroundColor": "#102030",
		"style": "style.css",
		"layers": [{
			"id": "background",
			"type": "image",
			"src": "assets/background.png",
			"fit": "contain",
			"position": "top-left"
		}],
		"officialUI": {"showLogo": false, "showDetails": true, "textColor": "#fff"}
	}`)

	appearances := GetBootAppearances()
	if len(appearances) != 1 {
		t.Fatalf("unexpected boot appearance count: %d", len(appearances))
	}
	appearance := appearances[0]
	if !appearance.Enabled || appearance.Provider != "provider-one" || appearance.Appearance != "sunrise" {
		t.Fatalf("unexpected boot appearance identity: %+v", appearance)
	}
	if appearance.DisplayName != "日出" {
		t.Fatalf("unexpected localized boot appearance name: %s", appearance.DisplayName)
	}
	if len(appearance.Frontends) != 2 || appearance.Frontends[0] != "desktop" || appearance.Frontends[1] != "mobile" {
		t.Fatalf("unexpected normalized frontends: %v", appearance.Frontends)
	}
	if appearance.Style != "/boot-appearance-assets/provider-one/sunrise/style.css" {
		t.Fatalf("unexpected style URL: %s", appearance.Style)
	}
	if len(appearance.Layers) != 1 ||
		appearance.Layers[0].Src != "/boot-appearance-assets/provider-one/sunrise/assets/background.png" {
		t.Fatalf("unexpected layer: %+v", appearance.Layers)
	}
	if appearance.OfficialUI.ShowLogo || !appearance.OfficialUI.ShowDetails {
		t.Fatalf("unexpected official UI options: %+v", appearance.OfficialUI)
	}
}

func TestNormalizeBootAppearancePluginFrontends(t *testing.T) {
	frontends, err := normalizeBootAppearanceFrontends(nil, []string{"all", "browser", "desktop-window"})
	if err != nil {
		t.Fatal(err)
	}
	if len(frontends) != 2 || frontends[0] != "desktop" || frontends[1] != "mobile" {
		t.Fatalf("unexpected frontends inherited from plugin: %v", frontends)
	}
	frontends, err = normalizeBootAppearanceFrontends(nil, []string{"desktop", "browser-mobile", "desktop-window"})
	if err != nil {
		t.Fatal(err)
	}
	if len(frontends) != 1 || frontends[0] != "desktop" {
		t.Fatalf("browser and detached window frontends should be ignored: %v", frontends)
	}
	if _, err = normalizeBootAppearanceFrontends(nil, []string{"browser-desktop", "browser-mobile"}); err == nil {
		t.Fatal("browser-only plugins should not expose a native boot appearance")
	}
	if _, err = normalizeBootAppearanceFrontends([]string{"browser-desktop"}, []string{"all"}); err == nil {
		t.Fatal("boot appearance frontends should accept native frontends only")
	}
}

func TestBootAppearanceID(t *testing.T) {
	for _, id := range []string{"sunrise", "night-sky", "a1-b2"} {
		if !isValidBootAppearanceID(id) {
			t.Fatalf("valid ID was rejected: %s", id)
		}
	}
	for _, id := range []string{"", "-sunrise", "sunrise-", "night--sky", "Night", "night_sky",
		strings.Repeat("a", 65)} {
		if isValidBootAppearanceID(id) {
			t.Fatalf("invalid ID was accepted: %s", id)
		}
	}
}

func TestBootAppearanceVideoAndURL(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	writeBootAppearanceTestPlugin(t, "provider+one", "video", `{
		"schemaVersion": 1,
		"id": "video",
		"displayName": {"default": "Video"},
		"layers": [{
			"id": "background",
			"type": "video",
			"src": "assets/background.mp4",
			"poster": "assets/background.png"
		}]
	}`)
	mp4 := []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0x00, 0x00, 0x00, 0x00,
		'i', 's', 'o', 'm', 'm', 'p', '4', '2'}
	videoPath := filepath.Join(util.DataDir, "plugins", "provider+one", bootAppearanceDirName, "video", "assets",
		"background.mp4")
	if err := os.WriteFile(videoPath, mp4, 0644); err != nil {
		t.Fatal(err)
	}
	appearances := GetBootAppearances()
	if len(appearances) != 1 || len(appearances[0].Layers) != 1 {
		t.Fatalf("valid MP4 appearance should be listed: %+v", appearances)
	}
	if got := appearances[0].Layers[0].Src; got != "/boot-appearance-assets/provider%2Bone/video/assets/background.mp4" {
		t.Fatalf("unexpected encoded resource URL: %s", got)
	}
}

func TestBootAppearanceRejectsInvalidResources(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	writeBootAppearanceTestPlugin(t, "traversal", "invalid", `{
		"schemaVersion": 1,
		"id": "invalid",
		"displayName": {"default": "Invalid"},
		"layers": [{"id": "background", "type": "image", "src": "../outside.png"}]
	}`)
	if appearances := GetBootAppearances(); len(appearances) != 0 {
		t.Fatalf("path traversal appearance should be rejected: %+v", appearances)
	}

	pluginDir := filepath.Join(util.DataDir, "plugins", "traversal")
	appearanceDir := filepath.Join(pluginDir, bootAppearanceDirName, "invalid")
	if _, _, err := validateBootAppearanceResource(pluginDir, appearanceDir, "../outside.png", "image"); !errors.Is(err, ErrBootAppearanceAssetForbidden) {
		t.Fatalf("path traversal should be forbidden, got %v", err)
	}

	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.png")
	writeBootAppearanceTestPNG(t, outsidePath)
	linkPath := filepath.Join(appearanceDir, "assets", "linked.png")
	if err := os.Symlink(outsidePath, linkPath); err != nil {
		t.Skipf("create symlink failed: %s", err)
	}
	if _, _, err := validateBootAppearanceResource(pluginDir, appearanceDir, "assets/linked.png", "image"); !errors.Is(err, ErrBootAppearanceAssetForbidden) {
		t.Fatalf("symlink resource should be forbidden, got %v", err)
	}
}

func TestBootAppearanceRejectsInvalidManifestValues(t *testing.T) {
	tests := []struct {
		name     string
		manifest string
	}{
		{
			name: "color",
			manifest: `{
				"schemaVersion": 1,
				"id": "sample",
				"displayName": {"default": "Sample"},
				"backgroundColor": "red"
			}`,
		},
		{
			name: "frontend",
			manifest: `{
				"schemaVersion": 1,
				"id": "sample",
				"displayName": {"default": "Sample"},
				"frontends": ["browser-desktop"]
			}`,
		},
		{
			name: "duplicate layer ID",
			manifest: `{
				"schemaVersion": 1,
				"id": "sample",
				"displayName": {"default": "Sample"},
				"layers": [
					{"id": "background", "type": "image", "src": "assets/background.png"},
					{"id": "background", "type": "image", "src": "assets/background.png"}
				]
			}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupBootAppearanceTestDirs(t)
			writeBootAppearanceTestPlugin(t, "provider", "sample", test.manifest)
			if appearances := GetBootAppearances(); len(appearances) != 0 {
				t.Fatalf("invalid appearance should not be listed: %+v", appearances)
			}
		})
	}
}

func TestBootAppearanceRejectsOversizedResource(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	writeBootAppearanceTestPlugin(t, "provider", "sample", `{
		"schemaVersion": 1,
		"id": "sample",
		"displayName": {"default": "Sample"},
		"layers": [{"id": "background", "type": "image", "src": "assets/background.png"}]
	}`)
	imagePath := filepath.Join(util.DataDir, "plugins", "provider", bootAppearanceDirName, "sample", "assets",
		"background.png")
	if err := os.Truncate(imagePath, maxBootAppearanceImageSize+1); err != nil {
		t.Fatal(err)
	}
	if appearances := GetBootAppearances(); len(appearances) != 0 {
		t.Fatalf("an appearance with an oversized resource should not be listed: %+v", appearances)
	}
}

func TestBootAppearancePackageAndPathLimits(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	pluginDir := filepath.Join(util.DataDir, "plugins", "provider")
	appearanceDir := filepath.Join(pluginDir, bootAppearanceDirName, "sample")
	if err := os.MkdirAll(appearanceDir, 0755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= maxBootAppearanceEntries; i++ {
		if err := os.Mkdir(filepath.Join(appearanceDir, fmt.Sprintf("entry-%03d", i)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := validateBootAppearancePackage(pluginDir, appearanceDir); err == nil {
		t.Fatal("a package with too many entries should be rejected")
	}

	validSegments := strings.Repeat("a/", maxBootAppearancePathDepth-1) + "a.png"
	invalidSegments := "a/" + validSegments
	if !isSafeBootAppearanceRelativePath(validSegments) || isSafeBootAppearanceRelativePath(invalidSegments) {
		t.Fatalf("unexpected path depth validation: valid=%q invalid=%q", validSegments, invalidSegments)
	}
	if isSafeBootAppearanceRelativePath(strings.Repeat("a", maxBootAppearancePathLength+1) + ".png") {
		t.Fatal("an overlong resource path should be rejected")
	}
}

func TestBootAppearanceLogReasonDoesNotExposePath(t *testing.T) {
	reason := bootAppearanceLogReason(&os.PathError{Op: "open", Path: `C:\\private\\appearance`, Err: os.ErrPermission})
	if strings.Contains(reason, "private") || !strings.Contains(reason, "open") {
		t.Fatalf("unexpected safe log reason: %q", reason)
	}
}

func TestBootAppearanceSelection(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	writeBootAppearanceTestPlugin(t, "provider-one", "sunrise", `{
		"schemaVersion": 1,
		"id": "sunrise",
		"displayName": {"default": "Sunrise"},
		"frontends": ["desktop"],
		"layers": [{"id": "background", "type": "image", "src": "assets/background.png"}]
	}`)

	selection, err := SetBootAppearance("provider-one", "sunrise")
	if err != nil {
		t.Fatal(err)
	}
	if selection.Provider != "provider-one" || selection.Appearance != "sunrise" {
		t.Fatalf("unexpected selection: %+v", selection)
	}
	stored := GetBootAppearanceSelection()
	if stored != selection {
		t.Fatalf("unexpected stored selection: %+v", stored)
	}
	if appearance := GetBootAppearance(); !appearance.Enabled || appearance.Appearance != "sunrise" {
		t.Fatalf("selected appearance was not resolved: %+v", appearance)
	}

	originalSafeMode := util.SafeMode
	util.SafeMode = true
	if appearance := GetBootAppearance(); appearance.Enabled {
		t.Fatalf("safe mode should use the default appearance: %+v", appearance)
	}
	util.SafeMode = originalSafeMode

	if _, err = SetBootAppearance("provider-one", "missing"); !errors.Is(err, ErrBootAppearanceNotFound) {
		t.Fatalf("missing appearance should be rejected, got %v", err)
	}
	selection, err = SetBootAppearance("", "")
	if err != nil {
		t.Fatal(err)
	}
	if selection.Provider != "" || selection.Appearance != "" || GetBootAppearance().Enabled {
		t.Fatalf("default selection was not restored: %+v", selection)
	}
}

func TestInvalidBootAppearanceSelectionIsCleared(t *testing.T) {
	setupBootAppearanceTestDirs(t)
	manifest := `{
		"schemaVersion": 1,
		"id": "sunrise",
		"displayName": {"default": "Sunrise"},
		"layers": [{"id": "background", "type": "image", "src": "assets/background.png"}]
	}`
	writeBootAppearanceTestPlugin(t, "provider-one", "sunrise", manifest)
	if _, err := SetBootAppearance("provider-one", "sunrise"); err != nil {
		t.Fatal(err)
	}
	pluginDir := filepath.Join(util.DataDir, "plugins", "provider-one")
	if err := os.RemoveAll(pluginDir); err != nil {
		t.Fatal(err)
	}
	if selection := GetBootAppearanceSelection(); selection.Provider != "" || selection.Appearance != "" {
		t.Fatalf("removed provider should restore the default selection: %+v", selection)
	}

	writeBootAppearanceTestPlugin(t, "provider-one", "sunrise", manifest)
	if appearance := GetBootAppearance(); appearance.Enabled {
		t.Fatalf("reinstalled provider should not revive a stale selection: %+v", appearance)
	}
}

func setupBootAppearanceTestDirs(t *testing.T) {
	t.Helper()
	originalDataDir, originalConfDir := util.DataDir, util.ConfDir
	originalSafeMode, originalReadOnly := util.SafeMode, util.ReadOnly
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.ConfDir = filepath.Join(root, "conf")
	util.SafeMode, util.ReadOnly = false, false
	for _, dir := range []string{util.DataDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		util.DataDir, util.ConfDir = originalDataDir, originalConfDir
		util.SafeMode, util.ReadOnly = originalSafeMode, originalReadOnly
	})
}

func writeBootAppearanceTestPlugin(t *testing.T, provider, appearanceID, manifest string) {
	t.Helper()
	pluginDir := filepath.Join(util.DataDir, "plugins", provider)
	appearanceDir := filepath.Join(pluginDir, bootAppearanceDirName, appearanceID)
	assetsDir := filepath.Join(appearanceDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	pluginManifest := `{"name":"` + provider + `","version":"1.0.0","frontends":["desktop","mobile","browser-mobile"],` +
		`"bootAppearances":["` + appearanceID + `"]}`
	for filePath, content := range map[string]string{
		filepath.Join(pluginDir, "plugin.json"):                  pluginManifest,
		filepath.Join(appearanceDir, bootAppearanceManifestName): strings.TrimSpace(manifest),
		filepath.Join(appearanceDir, "style.css"):                "[data-layer=background] { opacity: 0.8; }",
	} {
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeBootAppearanceTestPNG(t, filepath.Join(assetsDir, "background.png"))
}

func writeBootAppearanceTestPNG(t *testing.T, filePath string) {
	t.Helper()
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 1, G: 2, B: 3, A: 255})
	if err = png.Encode(file, img); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
}
