// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if !strings.Contains(lockScreenPage, `<form id="authForm"`) ||
		!strings.Contains(lockScreenPage, `autocomplete="current-password"`) ||
		!strings.Contains(lockScreenPage, `id="authSubmit" type="submit"`) {
		t.Fatal("authentication page omits the sign-in form markup required by password managers")
	}
	rememberMeIndex := strings.Index(lockScreenPage, `id="rememberMe"`)
	if rememberMeIndex < strings.Index(lockScreenPage, `id="authSubmit"`) ||
		rememberMeIndex < strings.Index(lockScreenPage, `id="oidcLogin"`) {
		t.Fatal("combined authentication page renders remember me before a login action")
	}
}
