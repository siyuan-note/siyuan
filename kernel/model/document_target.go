// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type DocumentTargetRevision struct {
	Notebook string `json:"notebook"`
	Purpose  string `json:"purpose"`
	Revision string `json:"revision"`
}

type EffectiveDocumentTarget struct {
	Notebook              string
	Path                  string
	Structured            *conf.DocumentTarget
	DocCreateTemplatePath string
	Revision              string
	Rendered              bool
}

func lockDocumentTargetConfiguration() func() { return filesys.LockDocumentConfiguration() }

func ValidateNotebookDocumentTarget(boxID string, target *conf.DocumentTarget) error {
	if err := target.Validate(); err != nil || target == nil {
		return err
	}
	mode, err := filesys.DocumentAddressingMode(boxID)
	if err != nil {
		return err
	}
	if mode != 2 {
		return errors.New("structured document targets are unavailable in this release")
	}
	return filesys.CheckDocumentAddressing(boxID)
}

// GetDocCreateTarget 只解析继承，不渲染模板；版本仅覆盖参与继承的目标和正文模板字段。
func GetDocCreateTarget(boxID, purpose string) (*EffectiveDocumentTarget, error) {
	if !ast.IsNodeIDPattern(boxID) || purpose != "document" && purpose != "reference" && purpose != "dailyNote" {
		return nil, errors.New("invalid document target source or purpose")
	}
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	box, err := getOpenedBox(boxID)
	if err != nil {
		return nil, err
	}
	if err = filesys.CheckDocumentAddressing(boxID); err != nil {
		return nil, err
	}
	boxConf, err := readRawBoxConf(box.ID)
	if err != nil {
		return nil, err
	}
	if boxConf == nil {
		return nil, errors.New("notebook configuration is missing")
	}
	if boxConf.Encrypted {
		dek, ok := cachedDEKCopy(box.ID)
		if !ok {
			return nil, errors.New("unlock the notebook before reading document targets")
		}
		defer zeroAndClear(dek)
		if err = decryptBoxMetadata(box.ID, boxConf, dek); err != nil {
			return nil, err
		}
	}
	global := Conf.LoadFileTree()
	ret := &EffectiveDocumentTarget{}
	var localBox, localPath, localTemplate, globalBox, globalPath, globalTemplate string
	switch purpose {
	case "document":
		localBox, localPath, localTemplate = boxConf.DocCreateSaveBox, boxConf.DocCreateSavePath, boxConf.DocCreateTemplatePath
		globalBox, globalPath, globalTemplate = global.DocCreateSaveBox, global.DocCreateSavePath, global.DocCreateTemplatePath
		ret.Structured = boxConf.DocCreateTarget
	case "reference":
		localBox, localPath = boxConf.RefCreateSaveBox, boxConf.RefCreateSavePath
		globalBox, globalPath = global.RefCreateSaveBox, global.RefCreateSavePath
		ret.Structured = boxConf.RefCreateTarget
	case "dailyNote":
		localBox, localPath, localTemplate = boxID, boxConf.DailyNoteSavePath, boxConf.DailyNoteTemplatePath
		ret.Structured = boxConf.DailyNoteTarget
	}
	ret.DocCreateTemplatePath = localTemplate
	if ret.DocCreateTemplatePath == "" {
		ret.DocCreateTemplatePath = globalTemplate
	}
	if ret.Structured != nil {
		if err = ret.Structured.Validate(); err != nil {
			return nil, err
		}
		ret.Notebook = ret.Structured.Notebook
		ret.Revision = treenode.DocumentRevision([]interface{}{1, boxID, purpose, ret.Structured, ret.DocCreateTemplatePath})
		return ret, nil
	}
	ret.Notebook, ret.Path = localBox, localPath
	if localBox == "" && localPath == "" {
		ret.Notebook = globalBox
	}
	if ret.Notebook == "" || Conf.Box(ret.Notebook) == nil {
		ret.Notebook = boxID
	}
	if ret.Path == "" {
		ret.Path = globalPath
	}
	ret.Path = strings.TrimSpace(ret.Path)
	if ret.Notebook != boxID && ret.Path != "" && !strings.HasPrefix(ret.Path, "/") {
		ret.Path = "/" + ret.Path
	}
	ret.Revision = treenode.DocumentRevision([]interface{}{1, boxID, purpose, ret.Notebook, ret.Path,
		ret.DocCreateTemplatePath, localBox, localPath, localTemplate})
	return ret, nil
}

func checkDocumentTargetRevision(request *DocumentCreateRequest) error {
	if request.ExpectedTarget == nil {
		return nil
	}
	expected := request.ExpectedTarget
	target, err := GetDocCreateTarget(expected.Notebook, expected.Purpose)
	if err != nil {
		return err
	}
	if target.Revision != expected.Revision || target.Notebook != request.Notebook {
		return documentAddressingError("planChanged", errors.New("document creation target changed after planning"))
	}
	return nil
}
