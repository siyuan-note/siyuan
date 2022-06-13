// SiYuan - Build Your Eternal Digital Garden
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

import "github.com/88250/gulu"

func RemoveElem(slice []string, elem string) (ret []string) {
	for _, e := range slice {
		if e != elem {
			ret = append(ret, e)
		}
	}
	return
}

func ExcludeElem(slice, excludes []string) (ret []string) {
	ret = []string{}
	for _, e := range slice {
		if !gulu.Str.Contains(e, excludes) {
			ret = append(ret, e)
		}
	}
	return
}

func RemoveDuplicatedElem(slice []string) (ret []string) {
	allKeys := make(map[string]bool)
	for _, item := range slice {
		if _, value := allKeys[item]; !value {
			allKeys[item] = true
			ret = append(ret, item)
		}
	}
	return
}
