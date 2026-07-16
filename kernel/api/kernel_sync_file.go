// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
)

const syncContentSHA256Prefix = "sha256:"

func syncContentHashReader(reader io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", err
	}
	return syncContentSHA256Prefix + fmt.Sprintf("%x", hasher.Sum(nil)), nil
}

func syncContentHashFile(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return syncContentHashReader(file)
}

func writeKernelSyncReadError(c *gin.Context, code int, message string) {
	ret := gulu.Ret.NewResult()
	ret.Code = code
	ret.Msg = message
	c.JSON(code, ret)
}
