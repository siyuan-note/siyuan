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

package av

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const AttributeViewContextFilterSpec = 1

var (
	ErrInvalidAttributeViewContextFilter = errors.New("invalid attribute view context filter")
	ErrAttributeViewContextNotBound      = errors.New("current document is not bound to the context filter target database")
)

// AttributeViewContextFilter 描述物理数据库块独有的上下文筛选配置。
type AttributeViewContextFilter struct {
	Spec  int    `json:"spec"`
	KeyID string `json:"keyID"`
}

// AttributeViewContextFilterField 描述可用于物理数据库块上下文筛选的关联字段。
type AttributeViewContextFilterField struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Icon       string `json:"icon"`
	TargetAvID string `json:"targetAvID"`
}

// FilterContext 保存一次数据库块渲染所需的上下文筛选值，不参与持久化。
type FilterContext struct {
	KeyID                  string
	CurrentDocumentItemIDs []string
}

// ParseAttributeViewContextFilter 从数据库块 IAL 中解析上下文筛选配置。
func ParseAttributeViewContextFilter(data string) (ret *AttributeViewContextFilter, err error) {
	data = strings.TrimSpace(data)
	if "" == data {
		return
	}

	decoder := json.NewDecoder(bytes.NewBufferString(data))
	decoder.DisallowUnknownFields()
	ret = &AttributeViewContextFilter{}
	if err = decoder.Decode(ret); nil != err {
		err = fmt.Errorf("%w: %v", ErrInvalidAttributeViewContextFilter, err)
		ret = nil
		return
	}
	if err = ensureAttributeViewContextFilterJSONEOF(decoder); nil != err {
		ret = nil
		return
	}
	if AttributeViewContextFilterSpec != ret.Spec || "" == strings.TrimSpace(ret.KeyID) {
		err = ErrInvalidAttributeViewContextFilter
		ret = nil
	}
	return
}

func ensureAttributeViewContextFilterJSONEOF(decoder *json.Decoder) error {
	var trailing any
	err := decoder.Decode(&trailing)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if nil == err {
		return ErrInvalidAttributeViewContextFilter
	}
	return fmt.Errorf("%w: %v", ErrInvalidAttributeViewContextFilter, err)
}

// Validate 校验上下文筛选引用的是当前数据库中的有效关联字段。
func (filter *AttributeViewContextFilter) Validate(attrView *AttributeView) error {
	if nil == filter || AttributeViewContextFilterSpec != filter.Spec || nil == attrView {
		return ErrInvalidAttributeViewContextFilter
	}
	key, err := attrView.GetKey(filter.KeyID)
	if nil != err || nil == key || KeyTypeRelation != key.Type || nil == key.Relation ||
		"" == strings.TrimSpace(key.Relation.AvID) {
		return ErrInvalidAttributeViewContextFilter
	}
	return nil
}

// Marshal 返回适合写入数据库块 IAL 的紧凑 JSON。
func (filter *AttributeViewContextFilter) Marshal() (string, error) {
	if nil == filter {
		return "", nil
	}
	data, err := json.Marshal(filter)
	if nil != err {
		return "", err
	}
	return string(data), nil
}

// ContextFilterFields 返回整个数据库中可用于上下文筛选的关联字段，不受当前视图布局限制。
func (av *AttributeView) ContextFilterFields() (ret []*AttributeViewContextFilterField) {
	ret = []*AttributeViewContextFilterField{}
	if nil == av {
		return
	}
	for _, keyValues := range av.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		key := keyValues.Key
		if KeyTypeRelation != key.Type || nil == key.Relation || "" == strings.TrimSpace(key.Relation.AvID) {
			continue
		}
		ret = append(ret, &AttributeViewContextFilterField{
			ID: key.ID, Name: key.Name, Icon: key.Icon, TargetAvID: key.Relation.AvID,
		})
	}
	return
}
