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

package tools

import "testing"

func TestDocumentSearchDisplayFields(t *testing.T) {
	tests := []struct {
		name     string
		doc      map[string]string
		wantType string
		wantID   string
		wantName string
	}{
		{
			name: "document",
			doc: map[string]string{
				"path":  "/20260903120000-parent1/20260903123000-child01.sy",
				"hPath": "Notebook/Parent/Document",
				"box":   "20260903110000-boxid01",
			},
			wantType: "DOCUMENT",
			wantID:   "20260903123000-child01",
			wantName: "Document",
		},
		{
			name: "notebook",
			doc: map[string]string{
				"path":  "/",
				"hPath": "Notebook/",
				"box":   "20260903110000-boxid01",
			},
			wantType: "NOTEBOOK",
			wantID:   "20260903110000-boxid01",
			wantName: "Notebook",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			typ, id, name := documentSearchDisplayFields(test.doc)
			if typ != test.wantType || id != test.wantID || name != test.wantName {
				t.Fatalf("documentSearchDisplayFields() = (%q, %q, %q), want (%q, %q, %q)",
					typ, id, name, test.wantType, test.wantID, test.wantName)
			}
		})
	}
}
