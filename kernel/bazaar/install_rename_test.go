// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"errors"
	"testing"
)

func TestPackageRenameDoesNotRetryOtherErrors(t *testing.T) {
	expected := errors.New("invalid target")
	for _, result := range []error{nil, expected} {
		calls := 0
		err := renamePackageDirectoryWithRetry("source", "target", func(source, target string) error {
			calls++
			if source != "source" || target != "target" {
				t.Fatal("rename paths changed")
			}
			return result
		})
		if err != result || calls != 1 {
			t.Fatalf("rename returned %v after %d calls", err, calls)
		}
	}
}
