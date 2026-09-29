// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PrepareClipboardPasteAssets 在粘贴前复制普通附件并加密，全部完成后才返回替换链接。
// 生命周期租约覆盖整个批次，锁定等待写入或失败清理结束；源附件始终保持不变。
func PrepareClipboardPasteAssets(boxID string, references []string) (result map[string]string, err error) {
	if !ast.IsNodeIDPattern(boxID) || !IsEncryptedBox(boxID) {
		return nil, errors.New("target must be an encrypted notebook")
	}
	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(boxID)
	result = map[string]string{}
	created := []string{}
	defer func() {
		if err == nil {
			if len(created) > 0 {
				IncSync()
			}
			return
		}
		result = nil
		for _, filename := range created {
			if removeErr := os.Remove(filename); removeErr != nil && !os.IsNotExist(removeErr) {
				err = errors.Join(err, removeErr)
			}
		}
	}()
	assetDir := filepath.Join(util.DataDir, boxID, "assets")
	copied := map[string]string{}
	for _, reference := range references {
		parsed, parseErr := url.Parse(strings.TrimSpace(reference))
		if parseErr != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Opaque != "" {
			return nil, fmt.Errorf("invalid asset reference [%s]", reference)
		}
		assetPath := strings.TrimPrefix(parsed.Path, "/")
		if base, _ := util.SplitFileAnnotationRef(assetPath); base != "" {
			assetPath = base
		}
		if !strings.HasPrefix(assetPath, "assets/") || path.Clean(assetPath) != assetPath || strings.Contains(assetPath, "\\") {
			return nil, fmt.Errorf("invalid asset path [%s]", reference)
		}
		query, queryErr := url.ParseQuery(parsed.RawQuery)
		if queryErr != nil || len(query["box"]) > 1 {
			return nil, fmt.Errorf("invalid asset query [%s]", reference)
		}
		sourceBox := strings.TrimSpace(query.Get("box"))
		if sourceBox != "" && !ast.IsNodeIDPattern(sourceBox) {
			return nil, errors.New("invalid source notebook")
		}
		if sourceBox != "" && sourceBox != boxID && IsEncryptedBox(sourceBox) {
			return nil, errors.New("cannot copy assets between encrypted notebooks")
		}
		// 无 box 参数的旧引用优先在当前加密笔记本内解析，不重复复制已有附件。
		if sourceBox == "" {
			if _, existingErr := GetAssetAbsPathInBox(assetPath, boxID); existingErr == nil {
				sourceBox = boxID
			}
		}
		absPath, resolveErr := GetAssetAbsPathInBox(assetPath, sourceBox)
		if resolveErr != nil {
			return nil, resolveErr
		}
		effectiveBox := ExtractBoxIDFromAssetsPath(absPath)
		if IsEncryptedAssetPath(absPath) && effectiveBox != boxID {
			return nil, errors.New("cannot copy assets between encrypted notebooks")
		}
		targetPath := assetPath
		if effectiveBox != boxID {
			targetPath = copied[absPath]
			if targetPath == "" {
				if err = ensureReadableAssetLocal(absPath); err != nil {
					return nil, err
				}
				data, readErr := filelock.ReadFile(absPath)
				if readErr != nil {
					return nil, readErr
				}
				if err = os.MkdirAll(assetDir, 0755); err != nil {
					return nil, err
				}
				diskName := encryptedAssetName(filepath.Ext(absPath), ast.NewNodeID())
				targetFile := filepath.Join(assetDir, diskName)
				created = append(created, targetFile)
				storeErr := writeAssetFile(targetFile, bytes.NewReader(data), boxID, filepath.Base(absPath))
				clear(data)
				if storeErr != nil {
					return nil, storeErr
				}
				targetPath = path.Join("assets", diskName)
				copied[absPath] = targetPath
				if strings.EqualFold(filepath.Ext(absPath), ".pdf") && filelock.IsExist(absPath+".sya") {
					annotationPath, annotationErr := GetAssetAbsPathInBox(assetPath+".sya", sourceBox)
					if annotationErr != nil {
						return nil, annotationErr
					}
					annotation, annotationErr := filelock.ReadFile(annotationPath)
					if annotationErr != nil {
						return nil, annotationErr
					}
					annotationTarget := filepath.Join(assetDir, diskName+".sya")
					created = append(created, annotationTarget)
					annotationErr = writeAssetFile(annotationTarget, bytes.NewReader(annotation), boxID, filepath.Base(annotationPath))
					clear(annotation)
					if annotationErr != nil {
						return nil, annotationErr
					}
					copied[annotationPath] = targetPath + ".sya"
				}
			}
		}
		result[reference] = rewriteAssetReference(reference, assetReferenceRewriteOptions{
			pathMap: map[string]string{assetPath: targetPath}, targetBoxID: boxID, bindTargetBox: true,
		})
	}
	return result, nil
}
