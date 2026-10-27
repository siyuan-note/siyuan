// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"

	"github.com/88250/gulu"
)

func I18nTerm(language, key string) (ret string) {
	p := filepath.Join(WorkingDir, "appearance", "langs", language+".json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var m map[string]any
	if err = gulu.JSON.UnmarshalJSON(data, &m); err != nil {
		return
	}
	if v, ok := m[key].(string); ok {
		ret = v
	}
	return
}
