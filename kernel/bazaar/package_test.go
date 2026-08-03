// SiYuan - Refactor your thinking
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

import "testing"

func TestGetPreferredFunding(t *testing.T) {
	tests := []struct {
		name    string
		funding *Funding
		want    string
	}{
		{name: "missing funding"},
		{
			name: "platform priority",
			funding: &Funding{
				OpenCollective: "collective",
				Patreon:        "patron",
				GitHub:         "sponsor",
				Custom:         []string{"https://example.com"},
			},
			want: "https://opencollective.com/collective",
		},
		{
			name:    "complete platform URL",
			funding: &Funding{GitHub: "https://example.com/sponsor"},
			want:    "https://example.com/sponsor",
		},
		{
			name:    "custom text",
			funding: &Funding{Custom: []string{"支付宝：example"}},
			want:    "支付宝：example",
		},
		{
			name:    "custom mail address",
			funding: &Funding{Custom: []string{"mailto:sponsor@example.com"}},
			want:    "mailto:sponsor@example.com",
		},
		{
			name:    "skip invalid custom entries",
			funding: &Funding{Custom: []string{"", "javascript:alert(1)", "ftp://example.com", "https://example.com"}},
			want:    "https://example.com",
		},
		{
			name:    "plain text with colon",
			funding: &Funding{Custom: []string{"Note: scan the QR code"}},
			want:    "Note: scan the QR code",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := getPreferredFunding(test.funding); got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}
