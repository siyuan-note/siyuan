// SiYuan - From thought to insight, with agents
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

package plugin

import (
	"math"

	"github.com/dop251/goja"
	"github.com/siyuan-note/siyuan/kernel/plugin/crypto"
)

// normalizeAlgorithm 将 JS 的算法参数（字符串或对象）转换为算法层的 Algorithm。
func (h *cryptoHost) normalizeAlgorithm(rt *goja.Runtime, value goja.Value) (alg crypto.Algorithm, err error) {
	if goja.IsString(value) {
		alg.Name, err = crypto.CanonicalAlgorithmName(value.String())
		return
	}

	if !isJsValueNotNull(value) {
		err = crypto.NewError(crypto.ErrNameType, "algorithm must be a string or an object")
		return
	}
	object := value.ToObject(rt)
	if object == nil {
		err = crypto.NewError(crypto.ErrNameType, "algorithm must be a string or an object")
		return
	}

	nameValue := object.Get("name")
	if !goja.IsString(nameValue) {
		err = crypto.NewError(crypto.ErrNameType, "algorithm.name must be a string")
		return
	}
	if alg.Name, err = crypto.CanonicalAlgorithmName(nameValue.String()); err != nil {
		return
	}

	if hashValue := object.Get("hash"); isJsValueNotNull(hashValue) {
		if alg.Hash, err = h.normalizeHash(rt, hashValue); err != nil {
			return
		}
	}

	for _, member := range []struct {
		name   string
		target *[]byte
	}{
		{"iv", &alg.IV},
		{"counter", &alg.Counter},
		{"additionalData", &alg.AAD},
		{"salt", &alg.Salt},
		{"info", &alg.Info},
	} {
		if memberValue := object.Get(member.name); isJsValueNotNull(memberValue) {
			if *member.target, err = h.cryptoBytesOf(rt, memberValue, "algorithm."+member.name); err != nil {
				return
			}
		}
	}

	for _, member := range []struct {
		name   string
		target **int
	}{
		{"length", &alg.Length},
		{"tagLength", &alg.TagLength},
		{"iterations", &alg.Iterations},
	} {
		if memberValue := object.Get(member.name); isJsValueNotNull(memberValue) {
			var number int
			if number, err = integerOf(memberValue, "algorithm."+member.name); err != nil {
				return
			}
			*member.target = &number
		}
	}
	return
}

// normalizeHash 解析 hash 成员，取值可以是字符串或带 name 的对象。
func (h *cryptoHost) normalizeHash(rt *goja.Runtime, value goja.Value) (string, error) {
	if goja.IsString(value) {
		return crypto.CanonicalAlgorithmName(value.String())
	}

	object := value.ToObject(rt)
	if object == nil {
		return "", crypto.NewError(crypto.ErrNameType, "algorithm.hash must be a string or an object")
	}
	nameValue := object.Get("name")
	if !goja.IsString(nameValue) {
		return "", crypto.NewError(crypto.ErrNameType, "algorithm.hash.name must be a string")
	}
	return crypto.CanonicalAlgorithmName(nameValue.String())
}

// integerOf 将 JS 值转换为非负整数。
func integerOf(value goja.Value, name string) (int, error) {
	number := value.ToFloat()
	if math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) {
		return 0, crypto.NewError(crypto.ErrNameType, "%s must be an integer", name)
	}
	if number < 0 || number > math.MaxInt32 {
		return 0, crypto.NewError(crypto.ErrNameType, "%s is out of range", name)
	}
	return int(number), nil
}

// keyUsagesOf 解析用法数组，取值必须是规范定义的字符串。
func keyUsagesOf(rt *goja.Runtime, value goja.Value) ([]crypto.KeyUsage, error) {
	if !isJsArray(rt, value) {
		return nil, crypto.NewError(crypto.ErrNameType, "keyUsages must be an array")
	}

	ret := []crypto.KeyUsage{}
	var err error
	rt.ForOf(value, func(item goja.Value) bool {
		if !goja.IsString(item) {
			err = crypto.NewError(crypto.ErrNameType, "keyUsages must contain only strings")
			return false
		}

		usage := crypto.KeyUsage(item.String())
		if !containsKeyUsage(crypto.KeyUsages, usage) {
			err = crypto.NewError(crypto.ErrNameType, "%q is not a valid key usage", item.String())
			return false
		}
		if !containsKeyUsage(ret, usage) {
			ret = append(ret, usage)
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	return ret, nil
}

// keyFormatOf 解析密钥格式，取值必须是规范定义的字符串。
func keyFormatOf(value goja.Value) (crypto.KeyFormat, error) {
	if !goja.IsString(value) {
		return "", crypto.NewError(crypto.ErrNameType, "format must be a string")
	}

	format := crypto.KeyFormat(value.String())
	for _, cur := range crypto.KeyFormats {
		if cur == format {
			return format, nil
		}
	}
	return "", crypto.NewError(crypto.ErrNameType, "%q is not a valid key format", value.String())
}

func containsKeyUsage(usages []crypto.KeyUsage, usage crypto.KeyUsage) bool {
	for _, cur := range usages {
		if cur == usage {
			return true
		}
	}
	return false
}
