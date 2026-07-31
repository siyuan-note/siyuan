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

func TestReplaceReplayOperationID(t *testing.T) {
	replacements := map[string]string{"old": "new"}
	tests := []struct {
		action string
		want   string
	}{
		{action: "insert", want: "new"},
		{action: "update", want: "new"},
		{action: "delete", want: "old"},
		{action: "move", want: "old"},
	}

	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			operation := &Operation{Action: test.action, ID: "old"}
			if !replaceReplayOperationID(operation, replacements) {
				t.Fatal("expected replacement to be detected")
			}
			if operation.ID != test.want {
				t.Fatalf("expected operation ID %q, got %q", test.want, operation.ID)
			}
		})
	}
}
