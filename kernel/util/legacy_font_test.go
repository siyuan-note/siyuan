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
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyFontReplacementsExist(t *testing.T) {
	for _, font := range legacyFonts {
		replacement := LegacyFontReplacement("fonts/" + font.directory + "/" + font.file)
		info, err := os.Stat(filepath.Join("..", "..", "app", "appearance", filepath.FromSlash(replacement)))
		if replacement == "" || err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			t.Fatalf("replacement for %s is unavailable: %s, %v", font.directory, replacement, err)
		}
	}
	for _, path := range []string{"fonts/custom/font.ttf", "fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2", "fonts/JetBrainsMono-2.304/JetBrainsMono-Regular.woff2", "fonts/JetBrainsMono-1.0.3/unknown.woff", "../fonts/JetBrainsMono-1.0.3/JetBrainsMono-Regular.woff"} {
		if LegacyFontReplacement(path) != "" {
			t.Fatalf("unexpected mapping for %q", path)
		}
	}
}

func TestCleanupLegacyFont(t *testing.T) {
	for _, scenario := range []string{"original", "crlf", "modified", "large license", "extra", "subdirectory", "missing replacement", "empty replacement", "partial", "empty", "retry"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			font := legacyFont{"old", "font.ttf", "new/font.ttf", map[string]string{
				"font.ttf": fmt.Sprintf("%x", sha256.Sum256([]byte("original"))),
				"LICENSE":  fmt.Sprintf("%x", sha256.Sum256([]byte("license\n"))),
			}}
			write := func(name, content string) {
				t.Helper()
				file := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			write("old/font.ttf", "original")
			write("old/LICENSE", "license\n")
			write("new/font.ttf", "replacement")
			write("custom/font.ttf", "private")
			preserve := false
			switch scenario {
			case "crlf":
				write("old/LICENSE", "license\r\n")
			case "modified":
				write("old/font.ttf", "modified")
				preserve = true
			case "large license":
				write("old/LICENSE", strings.Repeat("x", 8193))
				preserve = true
			case "extra":
				write("old/notes.txt", "notes")
				preserve = true
			case "subdirectory":
				write("old/nested/font.ttf", "private")
				preserve = true
			case "missing replacement":
				os.Remove(filepath.Join(root, "new/font.ttf"))
				preserve = true
			case "empty replacement":
				write("new/font.ttf", "")
				preserve = true
			case "partial":
				os.Remove(filepath.Join(root, "old/font.ttf"))
			case "empty":
				os.Remove(filepath.Join(root, "old/font.ttf"))
				os.Remove(filepath.Join(root, "old/LICENSE"))
			}
			if err := cleanupLegacyFont(root, font); err != nil {
				t.Fatal(err)
			}
			_, err := os.Stat(filepath.Join(root, "old"))
			if preserve && err != nil || !preserve && !os.IsNotExist(err) {
				t.Fatalf("preserve=%v: %v", preserve, err)
			}
			if preserve {
				if _, err := os.Stat(filepath.Join(root, "old/LICENSE")); err != nil {
					t.Fatal("partially removed protected directory", err)
				}
			}
			if data, err := os.ReadFile(filepath.Join(root, "custom/font.ttf")); err != nil || string(data) != "private" {
				t.Fatal("changed custom font", err)
			}
			if err := cleanupLegacyFont(root, font); err != nil {
				t.Fatal("retry", err)
			}
		})
	}
}

func TestCleanupLegacyFontsPreservesLinks(t *testing.T) {
	for _, location := range []string{"root", "fonts", "directory", "file", "replacement"} {
		t.Run(location, func(t *testing.T) {
			root, outside := t.TempDir(), t.TempDir()
			font := legacyFonts[0]
			directory := filepath.Join(root, "fonts", font.directory)
			if err := os.MkdirAll(directory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(outside, "private"), []byte("private"), 0644); err != nil {
				t.Fatal(err)
			}
			replacement := filepath.Join(root, "fonts", filepath.FromSlash(font.replacement))
			if err := os.MkdirAll(filepath.Dir(replacement), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(replacement, []byte("replacement"), 0644); err != nil {
				t.Fatal(err)
			}
			switch location {
			case "root":
				root = filepath.Join(root, "linked")
			case "fonts":
				os.Remove(directory)
				os.Remove(replacement)
				os.Remove(filepath.Dir(replacement))
				os.Remove(filepath.Join(root, "fonts"))
			case "directory":
				os.Remove(directory)
			case "replacement":
				os.Remove(replacement)
			}
			link := map[string]string{"root": root, "fonts": filepath.Join(root, "fonts"), "directory": directory, "file": filepath.Join(directory, font.file), "replacement": replacement}[location]
			target := outside
			if location == "file" || location == "replacement" {
				target = filepath.Join(outside, "private")
			}
			if err := os.Symlink(target, link); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			if err := CleanupLegacyFonts(root); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(link); err != nil {
				t.Fatal("removed link", err)
			}
			if data, err := os.ReadFile(filepath.Join(outside, "private")); err != nil || string(data) != "private" {
				t.Fatal("changed linked file", err)
			}
		})
	}
}
