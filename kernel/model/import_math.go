// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "github.com/88250/lute"

// MathDelimiterCompatibilityEnabled is scoped to external paste/import entry points.
// Stored documents and ordinary editor conversions continue to use the existing syntax.
func MathDelimiterCompatibilityEnabled() bool {
	if Conf == nil {
		return true
	}
	editor := Conf.LoadEditor()
	if editor == nil {
		return true
	}
	value := editor.MathDelimiterCompatibility
	return value == nil || *value
}

func setImportMathDelimiters(engine *lute.Lute) {
	engine.SetLatexMath(MathDelimiterCompatibilityEnabled())
}
