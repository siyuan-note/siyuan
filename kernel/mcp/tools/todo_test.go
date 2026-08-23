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

func TestTodoWriteRejectsInvalidSessionContext(t *testing.T) {
	tests := []struct {
		name      string
		sessionID any
		include   bool
	}{
		{name: "missing"},
		{name: "wrong type", sessionID: 1, include: true},
		{name: "invalid ID", sessionID: "..", include: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			args := map[string]any{"todos": []any{}}
			if test.include {
				args["_sessionID"] = test.sessionID
			}
			result, err := todoWriteHandler(args)
			if err != nil {
				t.Fatal(err)
			}
			if !result.IsError {
				t.Fatalf("invalid Agent session context was accepted: %#v", test.sessionID)
			}
		})
	}
}
