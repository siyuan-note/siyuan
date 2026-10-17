package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestJunctionWorkspaceTemplatesAndAppearanceExport(t *testing.T) {
	for _, atWorkspace := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[atWorkspace], func(t *testing.T) {
			alias, _ := testutil.JunctionWorkspace(t, t.TempDir(), atWorkspace)
			previousData, previousAppearance, previousThemes, previousIcons, previousMode :=
				util.DataDir, util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode
			util.DataDir, util.AppearancePath = filepath.Join(alias, "data"), filepath.Join(alias, "conf", "appearance")
			util.ThemesPath, util.IconsPath, util.Mode = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons"), "prod"
			t.Cleanup(func() {
				util.DataDir, util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode =
					previousData, previousAppearance, previousThemes, previousIcons, previousMode
			})
			root := filepath.Join(util.DataDir, "templates", "package", "root.md")
			writeAppearanceTestFile(t, root, "root template")
			writeAppearanceTestFile(t, filepath.Join(filepath.Dir(root), "children", "child.md"), "child template")
			if _, err := resolveDocContentTemplatePath("package/root.md"); err != nil {
				t.Errorf("content template below junction: %v", err)
			}
			if _, err := resolveTemplatePackageFile(root, "children/child.md"); err != nil {
				t.Errorf("child template below junction: %v", err)
			}
			outside := t.TempDir()
			writeAppearanceTestFile(t, filepath.Join(outside, "child.md"), "outside")
			testutil.Junction(t, filepath.Join(filepath.Dir(root), "escape"), outside)
			if _, err := resolveDocContentTemplatePath("package/escape/child.md"); err == nil {
				t.Error("content template escaped templates root")
			}
			if _, err := resolveTemplatePackageFile(root, "escape/child.md"); err == nil {
				t.Error("child template escaped package root")
			}
			for _, relative := range []string{"themes/daylight/theme.css", "themes/midnight/theme.css", "icons/litheness/icon.js",
				"fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2", "fonts/Noto-COLRv1-2.051/LICENSE"} {
				writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, filepath.FromSlash(relative)), "built-in resource")
			}
			writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.css"), "custom theme")
			writeAppearanceTestFile(t, filepath.Join(util.IconsPath, "custom", "icon.js"), "custom icons")
			export := t.TempDir()
			if err := copyExportAppearance(export, "custom", "custom"); err != nil {
				t.Errorf("export appearance below junction: %v", err)
			} else if data, err := os.ReadFile(filepath.Join(export, "appearance", "themes", "custom", "theme.css")); err != nil || string(data) != "custom theme" {
				t.Errorf("exported custom theme: %q, %v", data, err)
			}
		})
	}
}
