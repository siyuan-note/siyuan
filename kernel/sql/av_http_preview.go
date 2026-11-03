// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"slices"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
)

type HTTPTemplatePreview struct {
	pending map[string]bool
}

// Prepare 同库模板共享求值顺序，首屏一并延后，避免下游模板读取未完成的联网结果。
func (preview *HTTPTemplatePreview) Prepare(database *av.AttributeView) bool {
	if preview == nil {
		return false
	}
	hasHTTP := false
	for _, values := range database.KeyValues {
		if strings.Contains(values.Key.Template, "httpGet") || strings.Contains(values.Key.RenderTemplate, "httpGet") {
			hasHTTP = true
			break
		}
	}
	if !hasHTTP {
		return false
	}
	if preview.pending == nil {
		preview.pending = map[string]bool{}
	}
	for _, values := range database.KeyValues {
		if values.Key.Type == av.KeyTypeTemplate || strings.TrimSpace(values.Key.RenderTemplate) != "" {
			preview.pending[values.Key.ID] = true
		}
	}
	return true
}

func (preview *HTTPTemplatePreview) Pending() []string {
	if preview == nil {
		return nil
	}
	keys := make([]string, 0, len(preview.pending))
	for key := range preview.pending {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
