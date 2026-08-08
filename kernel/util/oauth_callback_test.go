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
