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

//go:build linux && !android

package util

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLoadFontconfigFontsInheritedOutput(t *testing.T) {
	for _, wait := range []bool{false, true} {
		t.Run(strconv.FormatBool(wait), func(t *testing.T) {
			dir := t.TempDir()
			pidPath := filepath.Join(dir, "child.pid")
			t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
			t.Setenv("SIYUAN_TEST_FONT_CHILD_PID", pidPath)
			script := "#!/bin/sh\nsleep 30 &\necho $! > \"$SIYUAN_TEST_FONT_CHILD_PID\"\n"
			maxDuration := 5 * time.Second
			if wait {
				script += "wait\n"
				maxDuration += 10 * time.Second
			}
			if err := os.WriteFile(filepath.Join(dir, "fc-list"), []byte(script), 0755); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				data, err := os.ReadFile(pidPath)
				if err != nil {
					return
				}
				pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
				if err == nil {
					if process, err := os.FindProcess(pid); err == nil {
						_ = process.Kill()
					}
				}
			})
			started := time.Now()
			if fonts := loadPlatformFonts(); len(fonts) != 0 {
				t.Fatalf("incomplete command returned fonts: %+v", fonts)
			}
			if duration := time.Since(started); duration > maxDuration {
				t.Fatalf("inherited output exceeded command wait bound: %v", duration)
			}
		})
	}
}

func TestLoadFontconfigFonts(t *testing.T) {
	if _, err := exec.LookPath("fc-list"); nil != err {
		t.Skip("fc-list is unavailable")
	}
	fonts := loadPlatformFonts()
	if 0 == len(fonts) {
		t.Fatal("Fontconfig should return at least one system font")
	}
	for _, font := range fonts {
		if "" == font.Family || "" == font.DisplayName {
			t.Fatalf("Fontconfig returned an invalid font: %+v", font)
		}
		if font.Weight < 1 || 1000 < font.Weight {
			t.Fatalf("Fontconfig returned an invalid font weight: %+v", font)
		}
		switch font.Spacing {
		case "", FontSpacingProportional, FontSpacingDual, FontSpacingMonospace, FontSpacingCharacterCell:
		default:
			t.Fatalf("Fontconfig returned an invalid font spacing: %+v", font)
		}
	}
}
