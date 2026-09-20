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
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyFontURLs(t *testing.T) {
	oldRoot, oldMode, oldConf := util.AppearancePath, util.Mode, model.Conf
	util.AppearancePath, util.Mode = t.TempDir(), "prod"
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "test-password"
	t.Cleanup(func() { util.AppearancePath, util.Mode, model.Conf = oldRoot, oldMode, oldConf })
	engine := gin.New()
	serveAppearance(engine)
	for _, oldPath := range []string{
		"fonts/JetBrainsMono-1.0.3/JetBrainsMono-Regular.woff",
		"fonts/LxgwWenKai-Lite-1.311/LXGWWenKaiLite-Regular.ttf",
		"fonts/LxgwWenKai-Lite-1.501/LXGWWenKaiLite-Regular.ttf",
		"fonts/Noto-COLRv1-2.047/Noto-COLRv1.woff2",
	} {
		t.Run(oldPath, func(t *testing.T) {
			currentPath := util.LegacyFontReplacement(oldPath)
			if currentPath == "" {
				t.Fatal("missing compatibility mapping")
			}
			write := func(name, data string) {
				t.Helper()
				file := filepath.Join(util.AppearancePath, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte(data), 0644); err != nil {
					t.Fatal(err)
				}
			}
			check := func(want int, body string) {
				t.Helper()
				r := httptest.NewRecorder()
				engine.ServeHTTP(r, httptest.NewRequest("GET", "/appearance/"+oldPath+"?v=old", nil))
				if r.Code != want || body != "" && r.Body.String() != body {
					t.Fatalf("status=%d body=%q", r.Code, r.Body.String())
				}
			}
			write(currentPath, "current")
			check(200, "current")
			write(oldPath, "user modified")
			check(200, "user modified")
			if err := os.Remove(filepath.Join(util.AppearancePath, filepath.FromSlash(oldPath))); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(filepath.Join(util.AppearancePath, filepath.FromSlash(currentPath))); err != nil {
				t.Fatal(err)
			}
			check(404, "")
			outside := filepath.Join(t.TempDir(), "private")
			if err := os.WriteFile(outside, []byte("secret"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, filepath.Join(util.AppearancePath, filepath.FromSlash(currentPath))); err != nil {
				t.Skipf("symlink unavailable: %v", err)
			}
			check(403, "")
			os.Remove(filepath.Join(util.AppearancePath, filepath.FromSlash(currentPath)))
		})
	}
}
