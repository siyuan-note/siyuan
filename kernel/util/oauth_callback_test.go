// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strings"
	"testing"
)

func TestRenderOAuthCallbackPage(t *testing.T) {
	page := string(RenderOAuthCallbackPage("zh-CN", "已收到<script>", "返回思源 & 查看状态", true))
	for _, expected := range []string{`lang="zh-CN"`, "已收到&lt;script&gt;", "返回思源 &amp; 查看状态", `class="brand">SiYuan</div>`, `class="mark"`} {
		if !strings.Contains(page, expected) {
			t.Fatalf("OAuth callback page does not contain %q: %s", expected, page)
		}
	}
	if strings.Contains(page, "window.close") || strings.Contains(page, "已收到<script>") {
		t.Fatalf("OAuth callback page contains unsafe or auto-close content: %s", page)
	}
	failurePage := string(RenderOAuthCallbackPage("en", "Authorization failed", "Try again", false))
	if !strings.Contains(failurePage, `class="mark mark--error"`) {
		t.Fatalf("OAuth failure callback page does not use the error state: %s", failurePage)
	}
}

func TestRenderOAuthRedirectPage(t *testing.T) {
	page := string(RenderOAuthRedirectPage("en", "OIDC login completed", `/stage/build/desktop/?a=1&b="<script>`))
	for _, expected := range []string{
		`<meta http-equiv="refresh" content="0;url=/stage/build/desktop/?a=1&amp;b=&#34;&lt;script&gt;">`,
		`<a href="/stage/build/desktop/?a=1&amp;b=&#34;&lt;script&gt;">SiYuan</a>`,
		`class="mark"`,
	} {
		if !strings.Contains(page, expected) {
			t.Fatalf("redirect page does not contain %q: %s", expected, page)
		}
	}
	if strings.Contains(page, "<script>") {
		t.Fatal("redirect target introduced executable markup")
	}
	if page := string(RenderOAuthCallbackPage("en", "Done", "Close this window", true)); strings.Contains(page, `http-equiv="refresh"`) {
		t.Fatal("ordinary callback page unexpectedly navigates")
	}
}
