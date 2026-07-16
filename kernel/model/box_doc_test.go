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

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestDeterministicBoxDocID(t *testing.T) {
	boxID := "20260716120000-abcdefg"
	boxDocID := deterministicBoxDocID(boxID)
	if !ast.IsNodeIDPattern(boxDocID) {
		t.Fatalf("invalid box document ID [%s]", boxDocID)
	}
	if boxDocID != deterministicBoxDocID(boxID) {
		t.Fatalf("box document ID is not deterministic [%s]", boxDocID)
	}
	if boxDocID == deterministicBoxDocID("20260716120000-hijklmn") {
		t.Fatalf("different boxes generated the same document ID [%s]", boxDocID)
	}
}
