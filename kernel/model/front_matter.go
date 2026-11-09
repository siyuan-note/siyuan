// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"io"

	"go.yaml.in/yaml/v4"
)

func loadFrontMatter(data []byte, attrs *map[string]any) error {
	// 空白和仅有注释的元数据没有 YAML 文档，仍按空属性处理。
	loader, err := yaml.NewLoader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	err = loader.Load(attrs)
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}
