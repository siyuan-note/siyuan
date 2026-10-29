// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"database/sql"
	"errors"
	"fmt"
	"path"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// documentParentDisplayPath 由存储身份取得父级展示文本，不从旧标题中的斜杠猜测层级。
func documentParentDisplayPath(boxID, documentPath string) (string, error) {
	parentPath := path.Dir(documentPath)
	if parentPath == "/" || parentPath == "." {
		return "", nil
	}
	if parent := treenode.GetBlockTreeInExactBox(util.GetTreeID(parentPath+".sy"), boxID); parent != nil {
		return parent.HPath, nil
	}
	hpath, _, err := filesys.ReadDocHPath(boxID, parentPath+".sy")
	return hpath, err
}

type DocumentAddressingError struct {
	Reason         string
	Cause          error
	CleanIDs       []string
	UnsupportedIDs []string
}

func (err *DocumentAddressingError) Error() string { return err.Cause.Error() }
func (err *DocumentAddressingError) Unwrap() error { return err.Cause }

func documentAddressingError(reason string, err error) error {
	return &DocumentAddressingError{Reason: reason, Cause: err}
}

func checkDocumentPathNotebook(boxID string) error {
	if !ast.IsNodeIDPattern(boxID) {
		return errors.New("invalid notebook ID")
	}
	if _, err := getOpenedBox(boxID); err != nil {
		return err
	}
	if err := filesys.CheckDocumentAddressing(boxID); err != nil {
		return err
	}
	if treenode.DocumentMetadataState(boxID) != "ready" {
		return documentAddressingError("indexUnavailable", treenode.ErrDocumentMetadataUnavailable)
	}
	return nil
}

// GetDocPaths 仅查询指定笔记本；缺失身份与索引、源格式错误分别返回。
func GetDocPaths(boxID string, ids []string) (documents []*treenode.DocumentPath, missing []string, err error) {
	if len(ids) == 0 || len(ids) > 128 {
		return nil, nil, errors.New("ids must contain 1 to 128 document IDs")
	}
	for _, id := range ids {
		if !ast.IsNodeIDPattern(id) {
			return nil, nil, errors.New("invalid document ID")
		}
	}
	if err = checkDocumentPathNotebook(boxID); err != nil {
		return
	}
	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		return
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	mode, modeErr := filesys.DocumentAddressingMode(boxID)
	if modeErr != nil {
		return nil, nil, modeErr
	}
	documents, missing = []*treenode.DocumentPath{}, []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		document, readErr := treenode.GetDocumentPath(boxID, id, boxID, mode)
		if errors.Is(readErr, sql.ErrNoRows) {
			missing = append(missing, id)
			continue
		}
		if readErr != nil {
			return nil, nil, documentAddressingError("indexUnavailable", readErr)
		}
		documents = append(documents, document)
	}
	return
}

func documentRootRevision(boxID string) string {
	return treenode.DocumentRevision([]interface{}{1, boxID, documentaddressing.DefaultMode(), IsBoxDocEnabled()})
}

func getDocumentPath(boxID, id string) (*treenode.DocumentPath, error) {
	mode, err := filesys.DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	return treenode.GetDocumentPath(boxID, id, boxID, mode)
}

func resolveDocumentPath(boxID string, parentID *string, segments []string) (*treenode.ResolvedDocumentPath, error) {
	mode, err := filesys.DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	return treenode.ResolveDocumentPath(boxID, parentID, segments, boxID, documentRootRevision(boxID), mode)
}

func normalizeDocumentTitle(title string) string {
	return normalizeTitleText(title)
}

// appendDocumentHPath 只拼接显示文字，不对标题中的斜杠、点段或尾部字符做路径规范化。
func appendDocumentHPath(parent, title string) string {
	if parent == "/" {
		parent = ""
	}
	if title == "" {
		return parent
	}
	return parent + "/" + title
}

// ValidateDocumentTitle 校验新协议的完整输入，不通过截断、修剪或字符替换悄悄改变标题。
func ValidateDocumentTitle(format, text string) error {
	if format != "plain" {
		return documentAddressingError("unsupportedTitleFormat", errors.New("unsupported document title format"))
	}
	if !utf8.ValidString(text) || utf8.RuneCountInString(text) > 512 || text != normalizeDocumentTitle(text) || text == "." || text == ".." {
		return documentAddressingError("invalidTitle", errors.New("invalid document title"))
	}
	return nil
}

// ResolveDocPath 逐级精确匹配标题，不拆分标题内的字符，也不从同名候选中任取文档。
func ResolveDocPath(boxID, startKind string, startID *string, segments []string) (*treenode.ResolvedDocumentPath, error) {
	if len(segments) > 128 {
		return nil, errors.New("segments must contain at most 128 titles")
	}
	for _, segment := range segments {
		if err := ValidateDocumentTitle("plain", segment); err != nil {
			return nil, err
		}
		if segment == "" {
			return nil, documentAddressingError("invalidTitle", errors.New("empty ancestor title requires a document ID"))
		}
	}
	if startKind == "root" {
		if startID != nil {
			return nil, errors.New("root start must not contain a document ID")
		}
	} else if startKind != "document" || startID == nil || !ast.IsNodeIDPattern(*startID) {
		return nil, errors.New("invalid document path start")
	}
	if err := checkDocumentPathNotebook(boxID); err != nil {
		return nil, err
	}
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	if startID != nil && IsBoxDoc(boxID, *startID) {
		if bt := treenode.GetBlockTreeInExactBox(*startID, boxID); bt == nil || bt.Type != "d" {
			return nil, documentAddressingError("parentUnavailable", errors.New("notebook document is unavailable"))
		}
		startID = nil
	}
	ret, err := resolveDocumentPath(boxID, startID, segments)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, documentAddressingError("parentUnavailable", fmt.Errorf("parent document is unavailable in notebook [%s]", boxID))
	}
	if err != nil {
		return nil, documentAddressingError("indexUnavailable", err)
	}
	return ret, nil
}
