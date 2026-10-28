// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// CheckDocumentAddressing 仅校验笔记本 ID 格式；访问权限、源格式与认证由调用方检查。
func CheckDocumentAddressing(boxID string) error {
	return documentaddressing.CheckBox(boxID)
}

func DocumentAddressingMode(boxID string) (int, error) {
	if boxID == "" {
		return documentaddressing.DefaultMode(), nil
	}
	return documentaddressing.BoxMode(boxID)
}

func CheckDocumentSpecJSON(boxID string, data []byte) error {
	_, err := DocumentAddressingMode(boxID)
	if err != nil {
		return err
	}
	return treenode.CheckSpecJSON(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
}

func checkDocumentTreeSpec(tree *parse.Tree) error {
	_, err := DocumentAddressingMode(tree.Box)
	if err != nil {
		return err
	}
	return treenode.CheckSpec(tree)
}
