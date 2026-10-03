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

package bazaar

import (
	"strings"
	"testing"
)

func TestGithubOwnerRepo(t *testing.T) {
	tests := []struct {
		name    string
		repoURL string
		want    string
		ok      bool
	}{
		{name: "plain repository", repoURL: "https://github.com/owner/repo", want: "owner/repo", ok: true},
		{name: "trailing slash", repoURL: "https://github.com/owner/repo/", want: "owner/repo", ok: true},
		{name: "git suffix", repoURL: "https://github.com/owner/repo.git", want: "owner/repo", ok: true},
		{name: "surrounding spaces", repoURL: " https://github.com/owner/repo ", want: "owner/repo", ok: true},
		{name: "non GitHub host", repoURL: "https://gitee.com/owner/repo", want: "", ok: false},
		{name: "missing repository", repoURL: "https://github.com/owner", want: "", ok: false},
		{name: "extra path segment", repoURL: "https://github.com/a/b/c", want: "", ok: false},
		{name: "query string", repoURL: "https://github.com/owner/repo?tab=readme", want: "", ok: false},
		{name: "empty", repoURL: "", want: "", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := GithubOwnerRepo(test.repoURL)
			if ok != test.ok {
				t.Fatalf("expected ok=%v, got %v", test.ok, ok)
			}
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestRenderBazaarReleases(t *testing.T) {
	releases := []*githubRelease{
		nil,
		{TagName: "v1.0.0", PublishedAt: "2026-01-01T00:00:00Z", Body: "first release"},
		{TagName: "v1.2.0", PublishedAt: "2026-03-01T00:00:00Z", Body: "See [docs](https://example.com/docs)."},
		{TagName: "v1.1.0", PublishedAt: "2026-02-01T00:00:00Z", Body: ""},
		{TagName: "v1.3.0", PublishedAt: "2026-04-01T00:00:00Z", Draft: true, Body: "draft release"},
		{TagName: "", PublishedAt: "2026-05-01T00:00:00Z", Body: "missing tag"},
	}

	got := renderBazaarReleases("owner/repo", releases)
	if 3 != len(got) {
		t.Fatalf("expected 3 releases after dropping drafts and blank tags, got %d", len(got))
	}
	wantOrder := []string{"v1.2.0", "v1.1.0", "v1.0.0"}
	for i, want := range wantOrder {
		if got[i].Tag != want {
			t.Fatalf("expected tag %q at %d, got %q", want, i, got[i].Tag)
		}
	}
	if "" != got[1].HTML {
		t.Fatalf("expected empty release notes HTML, got %q", got[1].HTML)
	}
	if !strings.Contains(got[0].HTML, `target="_blank"`) {
		t.Fatalf("expected rendered links to open in a new target, got %q", got[0].HTML)
	}
}

func TestGithubAPIURLsPrefersOfficialAPI(t *testing.T) {
	u := "https://api.github.com/repos/owner/repo/releases?per_page=100"
	got := githubAPIURLs(u)
	if 1+len(githubAPIPrefixes) != len(got) {
		t.Fatalf("expected %d candidates, got %d", 1+len(githubAPIPrefixes), len(got))
	}
	if u != got[0] {
		t.Fatalf("expected the official API URL first, got %q", got[0])
	}
	for i, prefix := range githubAPIPrefixes {
		if want := prefix + u; want != got[i+1] {
			t.Fatalf("expected candidate %d to be %q, got %q", i+1, want, got[i+1])
		}
	}
}
