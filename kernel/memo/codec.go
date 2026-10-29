// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"bytes"
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"strings"
	"unicode/utf8"
)

// YAML 节点先作结构校验，禁用别名、重复键、自定义标签及隐式日期等类型。
func validateNode(n *yaml.Node, depth int) error {
	if depth > 16 || n.Alias != nil || n.Anchor != "" || n.Kind == yaml.AliasNode {
		return ErrInvalid
	}
	if n.Tag != "" && n.Tag != "!!map" && n.Tag != "!!seq" && n.Tag != "!!str" && n.Tag != "!!int" {
		return ErrInvalid
	}
	if n.Kind == yaml.MappingNode {
		seen := map[string]bool{}
		for i := 0; i < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Kind != yaml.ScalarNode || k.Tag != "!!str" || seen[k.Value] {
				return ErrInvalid
			}
			seen[k.Value] = true
			value := n.Content[i+1]
			if k.Value == "schema" {
				if value.Kind != yaml.ScalarNode || value.Tag != "!!int" {
					return ErrInvalid
				}
			} else if value.Kind == yaml.ScalarNode && value.Tag != "!!str" {
				return ErrInvalid
			}
		}
	}
	if n.Kind == yaml.SequenceNode {
		for _, c := range n.Content {
			if c.Kind == yaml.ScalarNode && c.Tag != "!!str" {
				return ErrInvalid
			}
		}
	}
	for _, c := range n.Content {
		if err := validateNode(c, depth+1); err != nil {
			return err
		}
	}
	return nil
}
func decode(data []byte, target interface{}) (string, error) {
	if len(data) > MaxFileSize || !utf8.Valid(data) || !bytes.HasPrefix(data, []byte("---\n")) {
		return "", ErrInvalid
	}
	end := bytes.Index(data[4:], []byte("\n---\n"))
	if end < 0 {
		return "", ErrInvalid
	}
	header := data[4 : 4+end]
	var node yaml.Node
	dec := yaml.NewDecoder(bytes.NewReader(header))
	if err := dec.Decode(&node); err != nil {
		return "", fmt.Errorf("%w: metadata", ErrInvalid)
	}
	if err := validateNode(&node, 0); err != nil {
		return "", err
	}
	var extra yaml.Node
	if dec.Decode(&extra) != io.EOF {
		return "", ErrInvalid
	}
	dec = yaml.NewDecoder(bytes.NewReader(header))
	dec.KnownFields(true)
	if err := dec.Decode(target); err != nil {
		return "", fmt.Errorf("%w: metadata fields", ErrInvalid)
	}
	return string(data[4+end+5:]), nil
}
func encode(value interface{}, body string) ([]byte, error) {
	if !utf8.ValidString(body) {
		return nil, ErrInvalid
	}
	header, err := yaml.Marshal(value)
	if err != nil {
		return nil, err
	}
	data := []byte("---\n" + strings.TrimSuffix(string(header), "\n") + "\n---\n" + body)
	if len(data) > MaxFileSize {
		return nil, ErrInvalid
	}
	return data, nil
}
func DecodeRecord(data []byte, id string) (Entry, error) {
	var r Record
	body, err := decode(data, &r)
	if err != nil {
		return Entry{}, err
	}
	r.Content = body
	if r.ID != id {
		return Entry{}, ErrInvalid
	}
	if err = validateRecord(r); err != nil {
		return Entry{}, err
	}
	return Entry{r, revision(data)}, nil
}
