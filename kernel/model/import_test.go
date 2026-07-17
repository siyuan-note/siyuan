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

package model

import "testing"

func TestIsSYNotebookExport(t *testing.T) {
	tests := []struct {
		name          string
		hasBoxConf    bool
		hasBoxDocMeta bool
		want          bool
	}{
		{name: "document export", want: false},
		{name: "notebook export with conf", hasBoxConf: true, want: true},
		{name: "notebook export with document metadata", hasBoxDocMeta: true, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSYNotebookExport(test.hasBoxConf, test.hasBoxDocMeta); got != test.want {
				t.Fatalf("isSYNotebookExport() = %v, want %v", got, test.want)
			}
		})
	}
}
