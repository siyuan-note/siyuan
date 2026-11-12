// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"errors"
	"fmt"
	"testing"

	"github.com/mattn/go-sqlite3"
)

func TestRecoverableDBFileError(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"FTS corruption", sqlite3.Error{Code: sqlite3.ErrCorrupt, ExtendedCode: sqlite3.ErrCorruptVTab}, true},
		{"wrapped corruption", fmt.Errorf("write index: %w", sqlite3.Error{Code: sqlite3.ErrCorrupt}), true},
		{"legacy corruption", errors.New("database disk image is malformed"), true},
		{"invalid parameter", errors.New("The parameter is incorrect"), true},
		{"unavailable file", errors.New("unable to open database file"), true},
		{"unrecognized or unauthenticated database", sqlite3.Error{Code: sqlite3.ErrNotADB}, false},
		{"authentication", sqlite3.Error{Code: sqlite3.ErrAuth}, false},
		{"constraint", sqlite3.Error{Code: sqlite3.ErrConstraint}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := isRecoverableDBFileError(test.err); got != test.want {
				t.Fatalf("isRecoverableDBFileError(%v) = %t, want %t", test.err, got, test.want)
			}
		})
	}
}
