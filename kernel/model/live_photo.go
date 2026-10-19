// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"path/filepath"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/heif"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var LivePhotoPreviews = livephoto.NewManager(func() string {
	return filepath.Join(util.TempDir, "assets-cache", "livephoto")
})

// ResolveLivePhotoAssetPath 沿用普通资源的真实路径校验，加密资源由带 box 的解析器验证边界。
func ResolveLivePhotoAssetPath(assetPath string) (string, error) {
	absPath, err := GetAssetAbsPathInBox(assetPath, "")
	if err != nil {
		return "", err
	}
	if !IsEncryptedAssetPath(absPath) {
		relativePath, relErr := filepath.Rel(util.DataDir, absPath)
		if relErr != nil {
			return "", relErr
		}
		_, validatedPath, resolveErr := ResolveDataAssetPath(filepath.ToSlash(relativePath))
		if resolveErr != nil || filepath.Clean(validatedPath) != filepath.Clean(absPath) {
			return "", errors.New("Live Photo asset resolves outside assets directory")
		}
	}
	return absPath, nil
}

// StartLivePhotoPreview 为在途任务取得独立租约，笔记本锁定先取消任务再排空租约。
func StartLivePhotoPreview(assetPath string, clientEncode bool) (livephoto.Session, error) {
	absPath, err := ResolveLivePhotoAssetPath(assetPath)
	if err != nil {
		return livephoto.Session{}, errors.New("Live Photo asset not found")
	}
	boxID := ExtractBoxIDFromAssetsPath(absPath)
	scope := ""
	if IsEncryptedBox(boxID) {
		scope = boxID
	}
	if err := AcquireEncryptedBoxOperation(scope); err != nil {
		return livephoto.Session{}, err
	}
	release := func() { ReleaseEncryptedBoxOperation(scope) }
	if err = EnsureAssetLocal(absPath); err != nil {
		release()
		return livephoto.Session{}, errors.New("Live Photo asset unavailable")
	}
	limit := int64(livephoto.MaxInputBytes)
	if scope != "" {
		limit += 2 * 1024 * 1024
	}
	data, err := heif.ReadFileLimited(absPath, limit)
	if err != nil {
		release()
		return livephoto.Session{}, errors.New("Live Photo asset exceeds preview size limit")
	}
	if scope != "" {
		HoldBoxReadLock(scope)
		dek, keyErr := GetDEKIfUnlocked(scope)
		if keyErr != nil {
			ReleaseBoxReadLock(scope)
			clear(data)
			release()
			return livephoto.Session{}, keyErr
		}
		plain, decodeErr := DecryptAsset(scope, filepath.Base(absPath), dek, data)
		clear(dek)
		clear(data)
		ReleaseBoxReadLock(scope)
		if decodeErr != nil {
			release()
			return livephoto.Session{}, decodeErr
		}
		data = plain
	}
	session, err := LivePhotoPreviews.Start(data, scope, absPath, clientEncode, release)
	if err != nil {
		return session, err
	}
	if scope != "" {
		lifecycle := getEncryptedBoxLifecycle(scope)
		lifecycle.lock.Lock()
		admitted := lifecycle.acceptOperations && lifecycle.state == EncryptedBoxStateUnlocked
		lifecycle.lock.Unlock()
		if !admitted {
			LivePhotoPreviews.Cancel(session.ID)
			return livephoto.Session{}, ErrEncryptedBoxNotUnlocked
		}
	}
	return session, nil
}

type DocumentPreviewImage struct {
	Src      string
	Video    string
	Notebook string
}

func DocPreviewImages(rootID string) (ret []DocumentPreviewImage, err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return nil, err
	}
	ret = []DocumentPreviewImage{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || n.Type != ast.NodeImage {
			return ast.WalkContinue
		}
		dest := n.ChildByType(ast.NodeLinkDest)
		if dest == nil || len(dest.Tokens) == 0 {
			return ast.WalkContinue
		}
		item := DocumentPreviewImage{Src: dest.TokensStr(), Notebook: tree.Box}
		if n.IALAttr(treenode.LivePhotoVersionAttr) == treenode.LivePhotoVersion {
			item.Video = treenode.ImageLivePhotoVideo(n)
		}
		ret = append(ret, item)
		return ast.WalkContinue
	})
	return
}
