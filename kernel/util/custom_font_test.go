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

package util

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCustomFontLifecycle(t *testing.T) {
	oldAppearancePath := AppearancePath
	AppearancePath = t.TempDir()
	resetCustomFontCache()
	t.Cleanup(func() {
		AppearancePath = oldAppearancePath
		resetCustomFontCache()
	})

	if err := os.MkdirAll(CustomFontDir(), 0755); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join("..", "..", "app", "appearance", "fonts", "LxgwWenKai-Lite-1.501",
		"LXGWWenKaiLite-Regular.ttf")
	tempPath := copyCustomFontForTest(t, sourcePath)

	font, created, err := InstallCustomFont(tempPath)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("the first import should create the font")
	}
	if len(font.ID) != 64 || font.Family != CustomFontFamilyPrefix+font.ID {
		t.Fatalf("unexpected custom font identity: %+v", font)
	}
	if font.DisplayName == "" || font.Weight < 1 {
		t.Fatalf("unexpected custom font metadata: %+v", font)
	}
	if len(font.Aliases) == 0 {
		t.Fatalf("custom font aliases are missing: %+v", font)
	}

	fonts := LoadCustomFonts()
	if len(fonts) != 1 || fonts[0].ID != font.ID {
		t.Fatalf("unexpected custom fonts: %+v", fonts)
	}
	fontPath, loaded, ok := GetCustomFontFile(font.ID)
	if !ok || loaded.ID != font.ID {
		t.Fatalf("custom font lookup failed: %+v", loaded)
	}
	if filepath.Ext(fontPath) != ".ttf" {
		t.Fatalf("unexpected font path: %s", fontPath)
	}

	duplicatePath := copyCustomFontForTest(t, sourcePath)
	duplicate, created, err := InstallCustomFont(duplicatePath)
	if err != nil {
		t.Fatal(err)
	}
	if created || duplicate.ID != font.ID {
		t.Fatalf("duplicate import was not detected: %+v", duplicate)
	}
	if _, err = os.Stat(duplicatePath); !os.IsNotExist(err) {
		t.Fatalf("duplicate temporary file was not removed: %v", err)
	}

	removed, err := RemoveCustomFont(font.ID)
	if err != nil {
		t.Fatal(err)
	}
	if removed.ID != font.ID || len(LoadCustomFonts()) != 0 {
		t.Fatalf("custom font was not removed: %+v", removed)
	}
}

func TestInstallCustomFontRejectsInvalidData(t *testing.T) {
	oldAppearancePath := AppearancePath
	AppearancePath = t.TempDir()
	resetCustomFontCache()
	t.Cleanup(func() {
		AppearancePath = oldAppearancePath
		resetCustomFontCache()
	})

	if err := os.MkdirAll(CustomFontDir(), 0755); err != nil {
		t.Fatal(err)
	}
	tempFile, err := os.CreateTemp(CustomFontDir(), ".font-*")
	if err != nil {
		t.Fatal(err)
	}
	tempPath := tempFile.Name()
	if _, err = tempFile.WriteString("not a font"); err != nil {
		t.Fatal(err)
	}
	if err = tempFile.Close(); err != nil {
		t.Fatal(err)
	}

	if _, _, err = InstallCustomFont(tempPath); err == nil ||
		!strings.Contains(err.Error(), "only TTF and OTF") {
		t.Fatalf("invalid font data should be rejected: %v", err)
	}
	if _, _, ok := GetCustomFontFile("../invalid"); ok {
		t.Fatal("invalid custom font ID should not resolve")
	}
}

func TestLoadCustomFontsCleansAbandonedTemporaryFiles(t *testing.T) {
	oldAppearancePath := AppearancePath
	AppearancePath = t.TempDir()
	resetCustomFontCache()
	t.Cleanup(func() {
		AppearancePath = oldAppearancePath
		resetCustomFontCache()
	})

	if err := os.MkdirAll(CustomFontDir(), 0755); err != nil {
		t.Fatal(err)
	}
	abandonedFile, err := os.CreateTemp(CustomFontDir(), ".font-*")
	if err != nil {
		t.Fatal(err)
	}
	abandonedPath := abandonedFile.Name()
	if err = abandonedFile.Close(); err != nil {
		t.Fatal(err)
	}

	activeFile, err := CreateCustomFontTemp()
	if err != nil {
		t.Fatal(err)
	}
	activePath := activeFile.Name()
	if err = activeFile.Close(); err != nil {
		t.Fatal(err)
	}

	LoadCustomFonts()
	if _, err = os.Stat(abandonedPath); !os.IsNotExist(err) {
		t.Fatalf("abandoned temporary font was not removed: %v", err)
	}
	if _, err = os.Stat(activePath); err != nil {
		t.Fatalf("active temporary font was removed: %v", err)
	}

	DiscardCustomFontTemp(activePath)
	if _, err = os.Stat(activePath); !os.IsNotExist(err) {
		t.Fatalf("discarded temporary font was not removed: %v", err)
	}
}

func copyCustomFontForTest(t *testing.T, sourcePath string) string {
	t.Helper()

	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()

	target, err := os.CreateTemp(CustomFontDir(), ".font-*")
	if err != nil {
		t.Fatal(err)
	}
	targetPath := target.Name()
	if _, err = io.Copy(target, source); err != nil {
		target.Close()
		t.Fatal(err)
	}
	if err = target.Close(); err != nil {
		t.Fatal(err)
	}
	return targetPath
}

func resetCustomFontCache() {
	customFontsLock.Lock()
	customFonts = nil
	customFontsLoaded = false
	customFontsLang = ""
	customFontTemps = map[string]struct{}{}
	customFontsLock.Unlock()
}
