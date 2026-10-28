// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"

	"github.com/siyuan-note/logging"
)

var SK = []byte("696D897C9AA0611B")

func AESEncrypt(str string) string {
	buf := &bytes.Buffer{}
	buf.Grow(4096)
	_, err := hex.NewEncoder(buf).Write([]byte(str))
	if err != nil {
		logging.LogErrorf("encrypt failed: %s", err)
		return ""
	}
	data := buf.Bytes()
	block, err := aes.NewCipher(SK)
	if err != nil {
		logging.LogErrorf("encrypt failed: %s", err)
		return ""
	}
	cbc := cipher.NewCBCEncrypter(block, []byte("RandomInitVector"))
	content := data
	content = pkcs5Padding(content, block.BlockSize())
	crypted := make([]byte, len(content))
	cbc.CryptBlocks(crypted, content)
	return hex.EncodeToString(crypted)
}

func pkcs5Padding(ciphertext []byte, blockSize int) []byte {
	padding := blockSize - len(ciphertext)%blockSize
	padtext := bytes.Repeat([]byte{byte(padding)}, padding)
	return append(ciphertext, padtext...)
}

func AESDecrypt(cryptStr string) []byte {
	crypt, err := hex.DecodeString(cryptStr)
	if err != nil {
		logging.LogErrorf("decrypt failed: %s", err)
		return nil
	}

	block, err := aes.NewCipher(SK)
	if err != nil {
		return nil
	}
	cbc := cipher.NewCBCDecrypter(block, []byte("RandomInitVector"))
	decrypted := make([]byte, len(crypt))
	cbc.CryptBlocks(decrypted, crypt)
	return pkcs5Trimming(decrypted)
}

func pkcs5Trimming(encrypt []byte) []byte {
	padding := encrypt[len(encrypt)-1]
	return encrypt[:len(encrypt)-int(padding)]
}

func SHA256Hash(data []byte) string {
	hash := sha256.New()
	hash.Write(data)
	return hex.EncodeToString(hash.Sum(nil))
}
