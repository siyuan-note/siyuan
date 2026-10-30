// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import "encoding/hex"

func validHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, e := hex.DecodeString(value)
	return e == nil
}
