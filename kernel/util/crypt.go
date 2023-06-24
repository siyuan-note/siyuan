// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"

	"github.com/siyuan-note/logging"
)

var SK = []byte("696D897C9AA0611B")

func AESEncrypt(str string) string {
	buf := &bytes.Buffer{}
	buf.Grow(4096)
	_, err := hex.NewEncoder(buf).Write([]byte(str))
	if nil != err {
		logging.LogErrorf("encrypt failed: %s", err)
		return ""
	}
	data := buf.Bytes()
	block, err := aes.NewCipher(SK)
	if nil != err {
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
	if nil != err {
		logging.LogErrorf("decrypt failed: %s", err)
		return nil
	}

	block, err := aes.NewCipher(SK)
	if nil != err {
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
