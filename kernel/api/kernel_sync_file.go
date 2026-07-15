// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const syncContentSHA256Prefix = "sha256:"

var errInvalidKernelSyncDocument = errors.New("invalid kernel sync document")

type kernelSyncDocumentLocation struct {
	boxID string
	path  string
}

func syncContentHashReader(reader io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", err
	}
	return syncContentSHA256Prefix + fmt.Sprintf("%x", hasher.Sum(nil)), nil
}

func syncContentHashFile(filePath, _ string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return syncContentHashReader(file)
}

func checkRootFilePreconditionLocked(root *os.Root, relativePath, ifMatch string, ifNoneMatch bool) (exists, ok bool, message string, err error) {
	file, err := root.Open(relativePath)
	if os.IsNotExist(err) {
		if ifMatch != "" {
			return false, false, "precondition failed: target does not exist", nil
		}
		return false, true, "", nil
	}
	if err != nil {
		return false, false, "", err
	}
	defer file.Close()
	if ifNoneMatch {
		return true, false, "precondition failed: target already exists", nil
	}
	if ifMatch != "" {
		actual, hashErr := syncContentHashReader(file)
		if hashErr != nil {
			return true, false, "", hashErr
		}
		if actual != ifMatch {
			return true, false, "precondition failed: target hash changed", nil
		}
	}
	return true, true, "", nil
}

func writeKernelSyncReadError(c *gin.Context, code int, message string) {
	ret := gulu.Ret.NewResult()
	ret.Code = code
	ret.Msg = message
	c.JSON(code, ret)
}

func kernelSyncNotebookDocumentLocation(guard workspacePathGuard) (documentID string, location kernelSyncDocumentLocation, documentPath bool, err error) {
	dataPath, err := filepath.Abs(util.DataDir)
	if err != nil {
		return "", location, false, err
	}
	resolvedDataPath, err := resolveExistingPath(dataPath)
	if err != nil {
		return "", location, false, err
	}
	lexical, lexicalInside, err := relativeKernelSyncPath(dataPath, guard.absPath)
	if err != nil {
		return "", location, false, err
	}
	physical, physicalInside, err := relativeKernelSyncPath(resolvedDataPath, guard.resolvedPath)
	if err != nil {
		return "", location, false, err
	}
	if !lexicalInside && !physicalInside {
		return "", location, false, nil
	}
	if lexicalInside != physicalInside || filepath.ToSlash(lexical) != filepath.ToSlash(physical) {
		return "", location, true, fmt.Errorf("%w: document path is redirected", errInvalidKernelSyncDocument)
	}
	return classifyKernelSyncDocumentPath(lexical)
}

func relativeKernelSyncPath(root, candidate string) (string, bool, error) {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return "", false, err
	}
	if filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false, nil
	}
	return filepath.Clean(relative), true, nil
}

func classifyKernelSyncDocumentPath(relative string) (documentID string, location kernelSyncDocumentLocation, documentPath bool, err error) {
	parts := strings.FieldsFunc(filepath.ToSlash(relative), func(r rune) bool { return r == '/' })
	if len(parts) < 2 || !ast.IsNodeIDPattern(parts[0]) || !strings.EqualFold(filepath.Ext(parts[len(parts)-1]), ".sy") {
		return "", location, false, nil
	}
	if filepath.Ext(parts[len(parts)-1]) != ".sy" {
		return "", location, true, fmt.Errorf("%w: document extension must be lowercase .sy", errInvalidKernelSyncDocument)
	}
	documentID = strings.TrimSuffix(parts[len(parts)-1], ".sy")
	if !ast.IsNodeIDPattern(documentID) {
		return "", location, true, fmt.Errorf("%w: document filename is not a block ID", errInvalidKernelSyncDocument)
	}
	location = kernelSyncDocumentLocation{boxID: parts[0], path: path.Clean("/" + strings.Join(parts[1:], "/"))}
	return documentID, location, true, nil
}
