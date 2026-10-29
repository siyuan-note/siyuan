// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"os"

	"github.com/siyuan-note/filelock"
)

// 以下是七牛云 Hash 算法实现 https://github.com/qiniu/qetag/blob/master/qetag.go

func GetEtagByHandle(f io.Reader, size int64) (etag string, err error) {
	blockCnt := BlockCount(size)
	sha1Buf := make([]byte, 0, 21)

	if blockCnt <= 1 { // file size <= 4M
		sha1Buf = append(sha1Buf, 0x16)
		sha1Buf, err = CalSha1(sha1Buf, f)
		if err != nil {
			return
		}
	} else { // file size > 4M
		sha1Buf = append(sha1Buf, 0x96)
		sha1BlockBuf := make([]byte, 0, blockCnt*20)
		for range blockCnt {
			body := io.LimitReader(f, BLOCK_SIZE)
			sha1BlockBuf, err = CalSha1(sha1BlockBuf, body)
			if err != nil {
				return
			}
		}
		sha1Buf, _ = CalSha1(sha1Buf, bytes.NewReader(sha1BlockBuf))
	}
	etag = base64.URLEncoding.EncodeToString(sha1Buf)
	return
}

func GetEtag(filename string) (etag string, err error) {
	f, err := filelock.OpenFile(filename, os.O_RDONLY, 0644)
	if err != nil {
		return
	}
	defer filelock.CloseFile(f)

	fi, err := f.Stat()
	if err != nil {
		return
	}

	etag, err = GetEtagByHandle(f, fi.Size())
	return
}

const (
	BLOCK_BITS = 22 // Indicate that the blocksize is 4M
	BLOCK_SIZE = 1 << BLOCK_BITS
)

func BlockCount(fsize int64) int {
	return int((fsize + (BLOCK_SIZE - 1)) >> BLOCK_BITS)
}

func CalSha1(b []byte, r io.Reader) ([]byte, error) {
	h := sha1.New()
	_, err := io.Copy(h, r)
	if err != nil {
		return nil, err
	}
	return h.Sum(b), nil
}
