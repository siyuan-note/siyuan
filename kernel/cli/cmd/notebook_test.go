// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
