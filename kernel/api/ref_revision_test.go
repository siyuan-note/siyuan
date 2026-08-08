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

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestHashBacklinkRevision(t *testing.T) {
	value := struct {
		ID   string
		Name string
	}{"20260725000000-test", "foo"}
	first := hashBacklinkRevision("bl1:", value)
	second := hashBacklinkRevision("bl1:", value)
	if first != second {
		t.Fatalf("expected stable revision, got %q and %q", first, second)
	}

	value.Name = "bar"
	changed := hashBacklinkRevision("bl1:", value)
	if first == changed {
		t.Fatalf("expected changed revision, got %q", changed)
	}
}

func TestCanonicalBacklinkKeywords(t *testing.T) {
	keywords := []string{"beta", "alphabet", "alpha"}
	canonical := canonicalBacklinkKeywords(keywords)
	if canonical[0] != "alphabet" || canonical[1] != "alpha" || canonical[2] != "beta" {
		t.Fatalf("unexpected canonical keywords: %#v", canonical)
	}
	if keywords[0] != "beta" {
		t.Fatalf("expected source keywords to remain unchanged: %#v", keywords)
	}
}

func TestNewBacklinkResponses(t *testing.T) {
	paths := []*model.Path{{ID: "20260725000000-source", Name: "Source", Count: 2}}
	pathResponses := newBacklinkPathResponses(paths)
	if len(pathResponses) != 1 || pathResponses[0].Revision == "" {
		t.Fatalf("expected path revision, got %#v", pathResponses)
	}
	paths[0].Updated = "20260725235959"
	updatedPathResponses := newBacklinkPathResponses(paths)
	if pathResponses[0].Revision != updatedPathResponses[0].Revision {
		t.Fatal("expected a timestamp-only change to preserve the visible item revision")
	}
	paths[0].Name = "Changed"
	changedPathResponses := newBacklinkPathResponses(paths)
	if pathResponses[0].Revision == changedPathResponses[0].Revision {
		t.Fatal("expected a visible path change to update the item revision")
	}

	contexts := []*model.Backlink{{
		ID:     "20260725000000-ref",
		DOM:    `<div data-node-id="20260725000000-ref"></div>`,
		Expand: true,
	}}
	contextResponses := newBacklinkContextResponses(contexts)
	if len(contextResponses) != 1 || contextResponses[0].ID != contexts[0].ID || contextResponses[0].Revision == "" {
		t.Fatalf("expected context ID and revision, got %#v", contextResponses)
	}
}
