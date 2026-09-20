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

package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAppearanceFileBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalPath, originalMode, originalConf := util.AppearancePath, util.Mode, model.Conf
	originalThemesPath, originalIconsPath := util.ThemesPath, util.IconsPath
	util.AppearancePath, util.Mode = filepath.Join(t.TempDir(), "conf", "appearance"), "prod"
	util.ThemesPath, util.IconsPath = filepath.Join(t.TempDir(), "themes"), filepath.Join(t.TempDir(), "icons")
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "test-password"
	t.Cleanup(func() {
		util.AppearancePath, util.Mode, model.Conf = originalPath, originalMode, originalConf
		util.ThemesPath, util.IconsPath = originalThemesPath, originalIconsPath
	})
	outside := t.TempDir()
	write := func(name, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"themes/local/theme.css", "icons/local/icon.js", "fonts/font.woff"} {
		write(appearanceTestResourcePath(name), "resource")
	}
	write(filepath.Join(util.AppearancePath, "themes/local/old.css"), "legacy")
	write(filepath.Join(util.AppearancePath, "themes/daylight/theme.css"), "built-in")
	write(filepath.Join(util.ThemesPath, "daylight/theme.css"), "shadow")
	write(filepath.Join(util.AppearancePath, "icons/litheness/icon.js"), "built-in")
	write(filepath.Join(util.IconsPath, "litheness/icon.js"), "shadow")
	write(filepath.Join(util.AppearancePath, "langs/en.json"), `{"fallback":"English"}`)
	write(filepath.Join(util.AppearancePath, "langs/fr.json"), `{"label":"French"}`)
	write(filepath.Join(filepath.Dir(util.AppearancePath), "conf.json"), `{"secret":"credential"}`)
	write(filepath.Join(outside, "theme.css"), "resource")
	write(filepath.Join(outside, "icon.js"), "resource")
	write(filepath.Join(util.AppearancePath, "boot/index.html"), "boot page")
	engine := gin.New()
	serveAppearance(engine)
	check := func(path string, status int, body string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/appearance/"+path, nil))
		if recorder.Code != status || (body != "" && !strings.Contains(recorder.Body.String(), body)) || strings.Contains(recorder.Body.String(), "credential") {
			t.Fatalf("%s: status=%d body=%q, want %d %q", path, recorder.Code, recorder.Body.String(), status, body)
		}
	}
	check("themes/local/theme.css", 200, "resource")
	check("themes/local/old.css", 404, "")
	check("Themes/local/old.css", 404, "")
	check("Themes/local/theme.css", 200, "resource")
	check("themes/daylight/theme.css", 200, "built-in")
	check("icons/litheness/icon.js", 200, "built-in")
	check("Icons/LITHENESS/icon.js", 200, "built-in")
	check("icons/local/icon.js", 200, "resource")
	check("fonts/font.woff", 200, "resource")
	check("langs/fr.json", 200, `"fallback":"English"`)
	check("langs/missing.json", 200, "English")
	check("themes/local/theme.js", 200, "")
	check("themes/local/", 404, "")
	check("../conf.json", 403, "")
	check("boot/", 200, "boot page")
	check("boot/?v=3.8.4-alpha.9&appearance=0", 200, "boot page")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/appearance/boot/index.html?v=3.8.4-alpha.9&appearance=0", nil))
	if recorder.Code != 301 || recorder.Header().Get("Location") != "./?v=3.8.4-alpha.9&appearance=0" {
		t.Fatalf("boot redirect: status=%d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
	if err := os.Remove(filepath.Join(util.AppearancePath, "boot/index.html")); err != nil {
		t.Fatal(err)
	}
	check("boot/", 404, "")
	link := func(target, name string) {
		t.Helper()
		if err := os.Symlink(target, appearanceTestResourcePath(name)); err != nil {
			t.Skipf("symlinks unavailable: %s", err)
		}
	}
	link(outside, "themes/linked")
	link(filepath.Join(filepath.Dir(util.AppearancePath), "conf.json"), "boot/index.html")
	check("boot/", 403, "")
	check("boot/index.html", 403, "")
	link(outside, "icons/linked")
	check("themes/linked/theme.css", 200, "resource")
	check("icons/linked/icon.js", 200, "resource")
	link("theme.css", "themes/local/alias.css")
	check("themes/local/alias.css", 200, "resource")
	link(appearanceTestResourcePath("themes/local/theme.css"), "themes/local/absolute.css")
	check("themes/local/absolute.css", 200, "resource")
	link(filepath.Join(outside, "theme.css"), "themes/linked/absolute.css")
	check("themes/linked/absolute.css", 200, "resource")
	link("en.json", "langs/alias.json")
	check("langs/alias.json", 200, `"fallback":"English"`)
	link(filepath.Join(util.AppearancePath, "langs/en.json"), "langs/absolute.json")
	check("langs/absolute.json", 200, `"fallback":"English"`)
	link("missing.css", "themes/local/broken.css")
	check("themes/local/broken.css", 403, "")
	link("loop.css", "themes/local/loop.css")
	check("themes/local/loop.css", 403, "")
	link(filepath.Dir(util.AppearancePath), "themes/local/escape")
	link(filepath.Join(filepath.Dir(util.AppearancePath), "conf.json"), "langs/leak.json")
	link(filepath.Join(filepath.Dir(util.AppearancePath), "conf.json"), "themes/local/theme.js")
	check("themes/local/escape/conf.json", 403, "")
	check("themes/local/escape/theme.js", 403, "")
	check("themes/local/theme.js", 403, "")
	check("langs/leak.json", 403, "")
	if err := os.Symlink(filepath.Dir(util.AppearancePath), filepath.Join(outside, "escape")); err != nil {
		t.Fatal(err)
	}
	check("themes/linked/escape/conf.json", 403, "")
	if err := os.Remove(filepath.Join(util.AppearancePath, "langs/en.json")); err != nil {
		t.Fatal(err)
	}
	link(filepath.Join(filepath.Dir(util.AppearancePath), "conf.json"), "langs/en.json")
	check("langs/fr.json", 403, "")
	check("langs/en.json", 403, "")
}

func appearanceTestResourcePath(name string) string {
	parts := strings.SplitN(name, "/", 3)
	if len(parts) >= 2 && (parts[0] == "themes" || parts[0] == "icons") {
		root := util.AppearancePackagePath(parts[0], parts[1])
		if len(parts) == 3 {
			return filepath.Join(root, parts[2])
		}
		return root
	}
	return filepath.Join(util.AppearancePath, name)
}
