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

import "testing"

func TestFilterBoxIconPreservesNetworkURL(t *testing.T) {
	for _, icon := range []string{
		"https://example.com/icon",
		"http://127.0.0.1:8080/icon.png?size=80",
		"HTTPS://example.com/icon.svg#preview",
	} {
		if got := filterBoxIcon(icon); got != icon {
			t.Fatalf("network icon URL was changed [expected=%q, actual=%q]", icon, got)
		}
	}
	if got := filterBoxIcon(" https://example.com/icon "); got != "https://example.com/icon" {
		t.Fatalf("network icon URL was not trimmed [actual=%q]", got)
	}
}

func TestIsNetworkIconURLRejectsOtherURLSchemes(t *testing.T) {
	for _, icon := range []string{
		"data:image/png;base64,AAAA",
		"file:///tmp/icon.png",
		"ftp://example.com/icon.png",
		"//example.com/icon.png",
		"https://",
	} {
		if isNetworkIconURL(icon) {
			t.Fatalf("unsupported icon URL was accepted [%q]", icon)
		}
	}
}

func TestFilterBoxIconKeepsExistingIconFormats(t *testing.T) {
	for _, icon := range []string{
		"1f600",
		"folder/icon.png",
		"api/icon/getDynamicIcon?type=1",
	} {
		if got := filterBoxIcon(icon); got != icon {
			t.Fatalf("existing icon value was changed [expected=%q, actual=%q]", icon, got)
		}
	}
}

func TestFilterBoxIconSanitizesCustomIconFilename(t *testing.T) {
	icon := `" onerror="alert(1).png`
	if got := filterBoxIcon(icon); got == icon {
		t.Fatalf("unsafe custom icon filename was preserved [%q]", icon)
	}
}
