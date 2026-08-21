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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInlineStylesCRUD(t *testing.T) {
	setupInlineStylesTest(t)

	styles, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if styles.Version != InlineStylesVersion || styles.Styles == nil || len(styles.Styles) != 0 {
		t.Fatalf("unexpected empty inline styles: %#v", styles)
	}
	if _, err = os.Stat(inlineStylesPath()); !os.IsNotExist(err) {
		t.Fatalf("get created inline styles file: %v", err)
	}

	saved, changed, err := SetInlineStyles([]*InlineStyle{
		{
			Name:  "  Combined  ",
			Light: &InlineStyleTheme{Color: " #AABBCC ", BackgroundColor: "#DDEEFF"},
			Dark:  &InlineStyleTheme{Color: "#112233", BackgroundColor: "#445566"},
		},
		{
			ID:    "20260821000000-abcdefg",
			Name:  "Background",
			Light: &InlineStyleTheme{BackgroundColor: "#ABCDEF"},
			Dark:  &InlineStyleTheme{BackgroundColor: "#123456"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(saved.Styles) != 2 || !ast.IsNodeIDPattern(saved.Styles[0].ID) {
		t.Fatalf("unexpected saved inline styles: %#v", saved)
	}
	if saved.Styles[0].Name != "Combined" || saved.Styles[0].Light.Color != "#aabbcc" ||
		saved.Styles[0].Light.BackgroundColor != "#ddeeff" || saved.Styles[1].Light.BackgroundColor != "#abcdef" {
		t.Fatalf("inline styles were not normalized: %#v", saved)
	}

	loaded, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Styles) != 2 || loaded.Styles[0].ID != saved.Styles[0].ID ||
		loaded.Styles[1].ID != saved.Styles[1].ID {
		t.Fatalf("inline style order or IDs changed: %#v", loaded)
	}
	if _, changed, err = SetInlineStyles(loaded.Styles); err != nil || changed {
		t.Fatalf("unchanged inline styles were rewritten: changed=%t, err=%v", changed, err)
	}
}

func TestInlineStylesValidation(t *testing.T) {
	validID := "20260821000000-abcdefg"
	valid := func() *InlineStyle {
		return &InlineStyle{
			ID:    validID,
			Name:  "Valid",
			Light: &InlineStyleTheme{Color: "#abcdef"},
			Dark:  &InlineStyleTheme{Color: "#123456"},
		}
	}
	tests := []struct {
		name   string
		styles func() []*InlineStyle
	}{
		{name: "null style", styles: func() []*InlineStyle { return []*InlineStyle{nil} }},
		{name: "invalid ID", styles: func() []*InlineStyle {
			style := valid()
			style.ID = "invalid"
			return []*InlineStyle{style}
		}},
		{name: "duplicate ID", styles: func() []*InlineStyle { return []*InlineStyle{valid(), valid()} }},
		{name: "empty name", styles: func() []*InlineStyle {
			style := valid()
			style.Name = "  "
			return []*InlineStyle{style}
		}},
		{name: "long name", styles: func() []*InlineStyle {
			style := valid()
			style.Name = strings.Repeat("界", maxInlineStyleNameRunes+1)
			return []*InlineStyle{style}
		}},
		{name: "missing theme", styles: func() []*InlineStyle {
			style := valid()
			style.Dark = nil
			return []*InlineStyle{style}
		}},
		{name: "empty fields", styles: func() []*InlineStyle {
			style := valid()
			style.Light = &InlineStyleTheme{}
			style.Dark = &InlineStyleTheme{}
			return []*InlineStyle{style}
		}},
		{name: "different fields", styles: func() []*InlineStyle {
			style := valid()
			style.Dark = &InlineStyleTheme{BackgroundColor: "#123456"}
			return []*InlineStyle{style}
		}},
		{name: "invalid color", styles: func() []*InlineStyle {
			style := valid()
			style.Light.Color = "#abc"
			return []*InlineStyle{style}
		}},
		{name: "too many styles", styles: func() []*InlineStyle {
			styles := make([]*InlineStyle, maxInlineStyles+1)
			for i := range styles {
				styles[i] = &InlineStyle{
					Name:  "Style",
					Light: &InlineStyleTheme{Color: "#abcdef"},
					Dark:  &InlineStyleTheme{Color: "#123456"},
				}
			}
			return styles
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupInlineStylesTest(t)
			if _, _, err := SetInlineStyles(test.styles()); err == nil {
				t.Fatal("expected validation error")
			}
			if _, err := os.Stat(inlineStylesPath()); !os.IsNotExist(err) {
				t.Fatalf("invalid inline styles were written: %v", err)
			}
		})
	}
}

func TestInlineStylesInvalidFileIsNotOverwritten(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "invalid JSON", data: []byte(`{"version":`)},
		{name: "future version", data: []byte(`{"version":2,"styles":[]}`)},
		{name: "oversized", data: bytes.Repeat([]byte("x"), maxInlineStylesFileSize+1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupInlineStylesTest(t)
			if err := os.MkdirAll(filepath.Dir(inlineStylesPath()), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(inlineStylesPath(), test.data, 0644); err != nil {
				t.Fatal(err)
			}

			if _, err := GetInlineStyles(); err == nil {
				t.Fatal("expected invalid inline styles error")
			}
			if _, _, err := SetInlineStyles([]*InlineStyle{{
				Name:  "Replacement",
				Light: &InlineStyleTheme{Color: "#abcdef"},
				Dark:  &InlineStyleTheme{Color: "#123456"},
			}}); err == nil {
				t.Fatal("expected replacement to be rejected")
			}
			current, err := os.ReadFile(inlineStylesPath())
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(current, test.data) {
				t.Fatal("invalid inline styles file was overwritten")
			}
		})
	}
}

func TestInlineStylesRepoPath(t *testing.T) {
	setupInlineStylesTest(t)
	if !isInlineStylesRepoPath("/storage/inline-styles.json") {
		t.Fatal("inline styles repository path was not recognized")
	}
	for _, filePath := range []string{
		"storage/inline-styles.json",
		"/storage/inline-styles.json.bak",
		"/storage/nested/inline-styles.json",
	} {
		if isInlineStylesRepoPath(filePath) {
			t.Fatalf("unexpected inline styles repository path match: %s", filePath)
		}
	}
	if ignore.CompileIgnoreLines(getSyncIgnoreLines()...).MatchesPath(inlineStylesRepoPath) {
		t.Fatal("inline styles file is ignored by data synchronization")
	}
}

func setupInlineStylesTest(t *testing.T) {
	t.Helper()
	oldDataDir, oldConf := util.DataDir, Conf
	util.DataDir, Conf = t.TempDir(), NewAppConf()
	Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		util.DataDir, Conf = oldDataDir, oldConf
	})
}
