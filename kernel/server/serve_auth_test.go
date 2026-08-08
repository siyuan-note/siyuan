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
	"bytes"
	"html/template"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthPageActionLayout(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "app", "stage", "auth.html"))
	if err != nil {
		t.Fatal(err)
	}
	pageTemplate, err := template.New("auth").Parse(string(data))
	if err != nil {
		t.Fatal(err)
	}
	render := func(accessAuthCodeEnabled bool) string {
		var output bytes.Buffer
		if err = pageTemplate.Execute(&output, map[string]any{
			"accessAuthCodeEnabled": accessAuthCodeEnabled,
			"oidcEnabled":           true,
		}); err != nil {
			t.Fatal(err)
		}
		return output.String()
	}

	oidcOnlyPage := render(false)
	if !strings.Contains(oidcOnlyPage, `id="oidcLogin"`) ||
		!strings.Contains(oidcOnlyPage, `class="auth-actions"`) {
		t.Fatal("OIDC-only authentication page omits the OIDC action layout")
	}
	if strings.Index(oidcOnlyPage, `id="rememberMe"`) < strings.Index(oidcOnlyPage, `id="oidcLogin"`) {
		t.Fatal("OIDC-only authentication page renders remember me before the login action")
	}
	lockScreenPage := render(true)
	rememberMeIndex := strings.Index(lockScreenPage, `id="rememberMe"`)
	if rememberMeIndex < strings.Index(lockScreenPage, `onclick="submitAuth()"`) ||
		rememberMeIndex < strings.Index(lockScreenPage, `id="oidcLogin"`) {
		t.Fatal("combined authentication page renders remember me before a login action")
	}
}
