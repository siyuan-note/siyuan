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

package cmd

import (
	"errors"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestFormatNotebookWriteError(t *testing.T) {
	boxID := "20260803000000-abcdefg"
	closedErr := formatNotebookWriteError(boxID, model.ErrBoxClosed)
	if !strings.Contains(closedErr.Error(), "notebook open --id "+boxID) {
		t.Fatalf("closed notebook error does not include the open command: %v", closedErr)
	}

	notFoundErr := formatNotebookWriteError(boxID, model.ErrBoxNotFound)
	if got, want := notFoundErr.Error(), "notebook ["+boxID+"] not found"; got != want {
		t.Fatalf("unexpected missing notebook error: got %q, want %q", got, want)
	}

	otherErr := errors.New("other error")
	if got := formatNotebookWriteError(boxID, otherErr); got != otherErr {
		t.Fatalf("unexpected unrelated error replacement: got %v, want %v", got, otherErr)
	}
}
