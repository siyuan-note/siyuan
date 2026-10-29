// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// ReadDocumentTitle 从同一笔记本的索引或已认证源属性取得摘要，不从可读路径提取末段。
func ReadDocumentTitle(boxID, rootID string) (treenode.DocumentTitle, error) {
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		return treenode.DocumentTitle{}, err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	if meta, err := treenode.GetDocumentMetadata(boxID, rootID); err == nil {
		return meta.Title, nil
	}
	root := treenode.GetBlockTreeInExactBox(rootID, boxID)
	if root == nil || root.Type != "d" {
		return treenode.DocumentTitle{}, ErrTreeNotFound
	}
	tree, err := filesys.ReadDocumentMetadataTree(boxID, root.Path)
	if err != nil {
		return treenode.DocumentTitle{}, err
	}
	return treenode.ReadDocumentTitle(tree.Root), nil
}

func documentTitleText(boxID, rootID string) string {
	title, err := ReadDocumentTitle(boxID, rootID)
	if err != nil {
		if !errors.Is(err, ErrTreeNotFound) {
			logging.LogWarnf("read document title [%s/%s] failed: %s", boxID, rootID, err)
		}
		return ""
	}
	return title.Text
}

// recoverDocumentMetadata 从经过认证的源属性补建新增索引，不修改已有文档内容或身份。
func recoverDocumentMetadata(boxID string) (err error) {
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		return err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	// 全量源索引失败时不能只检查已存在的块行就宣告成功；缺失的源必须由重新索引处理。
	if treenode.DocumentMetadataState(boxID) == "error" {
		return treenode.ErrDocumentMetadataUnavailable
	}
	if err = treenode.SetDocumentMetadataState(boxID, "building"); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = treenode.SetDocumentMetadataState(boxID, "error")
		}
	}()
	pending, err := treenode.PendingDocumentMetadata(boxID)
	if err != nil {
		return err
	}
	for _, doc := range pending {
		if err = filesys.RecoverDocumentMetadataWrite(doc); err != nil {
			return err
		}
	}
	missing, err := treenode.MissingDocumentMetadata(boxID)
	if err != nil {
		return err
	}
	for _, doc := range missing {
		tree, readErr := filesys.ReadDocumentMetadataTree(boxID, doc.Path)
		if readErr != nil {
			return readErr
		}
		if err = treenode.RecoverDocumentMetadata(tree); err != nil {
			return err
		}
	}
	return treenode.SetDocumentMetadataState(boxID, "ready")
}

func recoverOpenedDocumentMetadata() {
	for _, box := range Conf.GetOpenedBoxes() {
		if err := recoverDocumentMetadata(box.ID); err != nil {
			logging.LogErrorf("recover document metadata [%s] failed: %s", box.ID, err)
		}
	}
}
