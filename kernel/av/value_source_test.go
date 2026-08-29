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

package av

import "testing"

func TestResolveValueSource(t *testing.T) {
	value := &Value{
		Type:            KeyTypeNumber,
		Number:          &ValueNumber{Content: 42, IsNotEmpty: true},
		RenderedContent: "forty-two",
	}
	if value != ResolveValueSource(value, "") || value != ResolveValueSource(value, ValueSourceStored) {
		t.Fatal("empty and stored sources should preserve the stored value")
	}

	rendered := ResolveValueSource(value, ValueSourceRendered)
	if KeyTypeTemplate != rendered.Type || nil == rendered.Template || "forty-two" != rendered.Template.Content {
		t.Fatalf("unexpected rendered value: %+v", rendered)
	}
	if KeyTypeNumber != value.Type || nil == value.Number {
		t.Fatal("resolving a rendered value should not mutate the stored value")
	}
}
