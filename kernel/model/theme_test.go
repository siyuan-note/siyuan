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

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestResolveCSSVars(t *testing.T) {
	variables := map[string]string{
		"--primary":   "#112233",
		"--nested":    "var(--primary)",
		"--cycle-a":   "var(--cycle-b)",
		"--cycle-b":   "var(--cycle-a)",
		"--with-fall": "var(--missing, #445566)",
	}
	input := `font-size: 18px; color: var(--nested); background-color: var(--missing, var(--with-fall, #778899)); ` +
		`border-color: var(--cycle-a, #abcdef); outline-color: var(--unknown); content: "var(--primary)"; ` +
		`box-shadow: 0 0 1px var(--missing-shadow, rgba(1, 2, 3, 0.5));`
	expected := `font-size: 18px; color: #112233; background-color: #445566; border-color: #abcdef; ` +
		`outline-color: var(--unknown); content: "var(--primary)"; box-shadow: 0 0 1px rgba(1, 2, 3, 0.5);`
	if actual := resolveCSSVars(input, variables); actual != expected {
		t.Fatalf("unexpected resolved CSS:\n%s\nwant:\n%s", actual, expected)
	}

	if actual := resolveCSSVars("color: var(--cycle-a);", variables); actual != "color: var(--cycle-a);" {
		t.Fatalf("cycle without fallback was changed: %s", actual)
	}
	if actual := resolveCSSVars("color: var(--missing,);", variables); actual != "color: ;" {
		t.Fatalf("empty fallback was not resolved: %s", actual)
	}
	commented := "color: var(--primary/**/, #000000); background-color: var(--primary /*,*/, #000000);"
	if actual := resolveCSSVars(commented, variables); actual != "color: #112233; background-color: #112233;" {
		t.Fatalf("comments in var arguments were not handled: %s", actual)
	}
}

func TestMergeInlineStyleThemeVars(t *testing.T) {
	styles := &InlineStyles{
		Version: InlineStylesVersion,
		Styles: []*InlineStyle{{
			ID:   "20260821000000-abcdefg",
			Name: "Combined",
			Light: &InlineStyleTheme{
				Color:           "#112233",
				BackgroundColor: "#445566",
			},
			Dark: &InlineStyleTheme{
				Color:           "#aabbcc",
				BackgroundColor: "#ddeeff",
			},
		}},
		Builtin: &InlineStyleBuiltin{
			Colors: []*InlineStyleBuiltinColor{{
				Index: 3,
				Light: &InlineStyleTheme{Color: "#010203", BackgroundColor: "#040506"},
				Dark:  &InlineStyleTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
			}},
			Styles: []*InlineStyleBuiltinStyle{{
				ID:    "warning",
				Light: &InlineStyleTheme{Color: "#111213", BackgroundColor: "#141516"},
				Dark:  &InlineStyleTheme{Color: "#171819", BackgroundColor: "#1a1b1c"},
			}},
		},
	}
	colorName := "--b3-inline-style-20260821000000-abcdefg-color"
	backgroundName := "--b3-inline-style-20260821000000-abcdefg-background-color"

	light := map[string]string{colorName: "#000000"}
	mergeInlineStyleThemeVars(light, styles, false)
	if light[colorName] != "#112233" || light[backgroundName] != "#445566" ||
		light["--b3-font-color3"] != "#010203" || light["--b3-font-background3"] != "#040506" ||
		light["--b3-inline-builtin-warning-color"] != "#111213" ||
		light["--b3-inline-builtin-warning-background-color"] != "#141516" ||
		light["--b3-card-warning-color"] != "#111213" || light["--b3-card-warning-background"] != "#141516" {
		t.Fatalf("unexpected light inline style variables: %#v", light)
	}

	dark := map[string]string{}
	mergeInlineStyleThemeVars(dark, styles, true)
	if dark[colorName] != "#aabbcc" || dark[backgroundName] != "#ddeeff" ||
		dark["--b3-font-color3"] != "#070809" || dark["--b3-font-background3"] != "#0a0b0c" ||
		dark["--b3-inline-builtin-warning-color"] != "#171819" ||
		dark["--b3-inline-builtin-warning-background-color"] != "#1a1b1c" ||
		dark["--b3-card-warning-color"] != "#171819" || dark["--b3-card-warning-background"] != "#1a1b1c" {
		t.Fatalf("unexpected dark inline style variables: %#v", dark)
	}
}

func TestFillThemeStyleVarUsesBuiltinOverrides(t *testing.T) {
	setupThemeTest(t, "daylight", `:root {
		--b3-font-color2: #010101;
		--b3-card-error-color: #020202;
		--b3-card-error-background: #030303;
	}`)
	Conf.Appearance.Mode = 0
	Conf.Appearance.ThemeLight = "daylight"

	if _, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles:  []*InlineStyle{},
		Builtin: &InlineStyleBuiltin{
			Colors: []*InlineStyleBuiltinColor{{
				Index: 2,
				Light: &InlineStyleTheme{Color: "#112233"},
				Dark:  &InlineStyleTheme{Color: "#445566"},
			}},
			Styles: []*InlineStyleBuiltinStyle{{
				ID:    "error",
				Light: &InlineStyleTheme{Color: "#aabbcc", BackgroundColor: "#ddeeff"},
				Dark:  &InlineStyleTheme{Color: "#123456", BackgroundColor: "#654321"},
			}},
		},
	}); err != nil {
		t.Fatal(err)
	}

	tree, node := inlineStyleThemeTestTree("color: var(--b3-card-error-color); " +
		"background-color: var(--b3-card-error-background); border-color: var(--b3-inline-builtin-error-color); " +
		"text-decoration-color: var(--b3-inline-builtin-error-background-color); " +
		"outline-color: var(--b3-font-color2);")
	fillThemeStyleVar(tree)
	if actual := node.KramdownIAL[0][1]; actual != "color: #aabbcc; background-color: #ddeeff; "+
		"border-color: #aabbcc; text-decoration-color: #ddeeff; outline-color: #112233;" {
		t.Fatalf("unexpected builtin inline style export: %s", actual)
	}
}

func TestFillThemeStyleVarUsesCurrentInlineStyleMode(t *testing.T) {
	setupThemeTest(t, "midnight", `:root {}`)
	Conf.Appearance.Mode = 1
	Conf.Appearance.ThemeDark = "midnight"

	const id = "20260821000000-abcdefg"
	if _, _, err := SetInlineStyles([]*InlineStyle{{
		ID:    id,
		Name:  "Foreground",
		Light: &InlineStyleTheme{Color: "#112233"},
		Dark:  &InlineStyleTheme{Color: "#aabbcc"},
	}}); err != nil {
		t.Fatal(err)
	}

	style := "font-size: 18px; color: var(--b3-inline-style-" + id + "-color, #445566);"
	tree, node := inlineStyleThemeTestTree(style)
	fillThemeStyleVar(tree)
	if actual := node.KramdownIAL[0][1]; actual != "font-size: 18px; color: #aabbcc;" {
		t.Fatalf("unexpected Word inline style: %s", actual)
	}
}

func TestFillThemeStyleVarFallsBackForInvalidInlineStyles(t *testing.T) {
	setupThemeTest(t, "daylight", `:root { --theme-background: #112233; }`)
	Conf.Appearance.Mode = 0
	Conf.Appearance.ThemeLight = "daylight"

	if err := os.MkdirAll(filepath.Dir(inlineStylesPath()), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inlineStylesPath(), []byte(`{"version":`), 0644); err != nil {
		t.Fatal(err)
	}

	tree, node := inlineStyleThemeTestTree("font-size: 18px; color: var(--missing, #abcdef); " +
		"background-color: var(--theme-background);")
	fillThemeStyleVar(tree)
	if actual := node.KramdownIAL[0][1]; actual != "font-size: 18px; color: #abcdef; background-color: #112233;" {
		t.Fatalf("invalid inline styles affected Word fallback: %s", actual)
	}
}

func inlineStyleThemeTestTree(style string) (tree *parse.Tree, node *ast.Node) {
	root := &ast.Node{Type: ast.NodeDocument}
	node = &ast.Node{Type: ast.NodeParagraph, KramdownIAL: [][]string{{"style", style}}}
	root.AppendChild(node)
	return &parse.Tree{Root: root}, node
}

func setupThemeTest(t *testing.T, theme, css string) {
	t.Helper()
	oldDataDir, oldThemesPath, oldConf := util.DataDir, util.ThemesPath, Conf
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.ThemesPath = filepath.Join(tempDir, "themes")
	Conf = NewAppConf()
	Conf.Appearance = conf.NewAppearance()
	Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		util.DataDir, util.ThemesPath, Conf = oldDataDir, oldThemesPath, oldConf
	})

	themeDir := filepath.Join(util.ThemesPath, theme)
	if err := os.MkdirAll(themeDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDir, "theme.css"), []byte(css), 0644); err != nil {
		t.Fatal(err)
	}
}
