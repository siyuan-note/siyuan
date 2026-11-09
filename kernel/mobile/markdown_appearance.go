// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package mobile

import (
	"errors"
	"runtime"

	"github.com/siyuan-note/siyuan/kernel/markdownappearance"
)

type MarkdownAppearance struct {
	resolver *markdownappearance.Resolver
}

// 根目录由原生宿主提供，查询不初始化或迁移工作空间。
func NewMarkdownAppearance(configDir, allowedRoot string) (*MarkdownAppearance, error) {
	resolver, err := markdownappearance.New(configDir, allowedRoot, runtime.GOOS)
	if err != nil {
		return nil, err
	}
	return &MarkdownAppearance{resolver: resolver}, nil
}

func (appearance *MarkdownAppearance) Resolve(preferences, patch string) (string, error) {
	if appearance == nil || appearance.resolver == nil {
		return "", errors.New("Markdown appearance unavailable")
	}
	return appearance.resolver.Resolve(preferences, patch)
}

func (appearance *MarkdownAppearance) ReadFont(token string) ([]byte, error) {
	if appearance == nil || appearance.resolver == nil {
		return nil, errors.New("Markdown appearance unavailable")
	}
	return appearance.resolver.ReadFont(token)
}

func (appearance *MarkdownAppearance) Close() {
	if appearance != nil && appearance.resolver != nil {
		appearance.resolver.Close()
	}
}
