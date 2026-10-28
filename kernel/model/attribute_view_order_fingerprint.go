// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/binary"
	"encoding/json"
	"hash"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// attributeViewOrderFingerprint 对普通值保留全部 JSON 字段的输入，缓冲区不随字段内容增长。
type attributeViewOrderFingerprint struct {
	digest hash.Hash
	buffer [4096]byte
	used   int
}

func (fingerprint *attributeViewOrderFingerprint) flush() {
	_, _ = fingerprint.digest.Write(fingerprint.buffer[:fingerprint.used])
	fingerprint.used = 0
}

func (fingerprint *attributeViewOrderFingerprint) flag(value bool) {
	if fingerprint.used == len(fingerprint.buffer) {
		fingerprint.flush()
	}
	if value {
		fingerprint.buffer[fingerprint.used] = 1
	} else {
		fingerprint.buffer[fingerprint.used] = 0
	}
	fingerprint.used++
}

func (fingerprint *attributeViewOrderFingerprint) integer(value int64) {
	if len(fingerprint.buffer)-fingerprint.used < binary.MaxVarintLen64 {
		fingerprint.flush()
	}
	fingerprint.used += binary.PutVarint(fingerprint.buffer[fingerprint.used:], value)
}

func (fingerprint *attributeViewOrderFingerprint) text(value string) {
	if len(fingerprint.buffer)-fingerprint.used < binary.MaxVarintLen64 {
		fingerprint.flush()
	}
	fingerprint.used += binary.PutUvarint(fingerprint.buffer[fingerprint.used:], uint64(len(value)))
	for len(value) > 0 {
		if fingerprint.used == len(fingerprint.buffer) {
			fingerprint.flush()
		}
		copied := copy(fingerprint.buffer[fingerprint.used:], value)
		fingerprint.used += copied
		value = value[copied:]
	}
}

func plainAttributeViewOrderValue(value *av.Value) bool {
	return value == nil || (value.Number == nil && value.Date == nil && value.MSelect == nil &&
		value.URL == nil && value.Email == nil && value.Phone == nil && value.Location == nil &&
		value.MAsset == nil && value.Created == nil && value.Updated == nil && value.Checkbox == nil &&
		value.Relation == nil && value.Rollup == nil && (value.Text == nil || value.Text.Rich == nil))
}

func (fingerprint *attributeViewOrderFingerprint) value(value *av.Value) {
	fingerprint.flag(value != nil)
	if value == nil {
		return
	}
	fingerprint.text(value.ID)
	fingerprint.text(value.KeyID)
	fingerprint.text(value.BlockID)
	fingerprint.text(string(value.Type))
	fingerprint.flag(value.IsDetached)
	fingerprint.integer(value.CreatedAt)
	fingerprint.integer(value.UpdatedAt)
	fingerprint.text(value.RenderedContent)
	fingerprint.flag(value.HasRenderTemplate)
	fingerprint.flag(value.Block != nil)
	if block := value.Block; block != nil {
		fingerprint.text(block.CollectionRuleID)
		fingerprint.text(block.ID)
		fingerprint.text(block.Icon)
		fingerprint.text(block.Content)
		fingerprint.text(string(block.RefSubtype))
		fingerprint.integer(block.Created)
		fingerprint.integer(block.Updated)
	}
	fingerprint.flag(value.Text != nil)
	if value.Text != nil {
		fingerprint.text(value.Text.Content)
	}
	fingerprint.flag(value.Template != nil)
	if value.Template != nil {
		fingerprint.text(value.Template.Content)
	}
}

func (fingerprint *attributeViewOrderFingerprint) writeValues(encoder *json.Encoder, values []*av.Value) error {
	for start := 0; start < len(values); start += 128 {
		chunk := values[start:min(start+128, len(values))]
		plain := true
		for _, value := range chunk {
			if !plainAttributeViewOrderValue(value) {
				plain = false
				break
			}
		}
		fingerprint.flag(plain)
		if plain {
			for _, value := range chunk {
				fingerprint.value(value)
			}
		} else {
			fingerprint.flush()
			if err := encoder.Encode(chunk); err != nil {
				return err
			}
		}
	}
	fingerprint.flush()
	return nil
}
