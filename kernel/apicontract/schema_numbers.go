package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
)

// decodeSchemaJSON 保留线协议的数字精度，避免诊断数据中的大整数溢出浮点范围。
func decodeSchemaJSON(payload []byte, value *any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err != nil {
			return err
		}
		return fmt.Errorf("multiple JSON values in response")
	}
	return nil
}

func validSchemaNumber(value any, integer bool) bool {
	switch number := value.(type) {
	case json.Number:
		parsed, ok := new(big.Rat).SetString(string(number))
		return ok && (!integer || parsed.IsInt())
	case float64:
		return !math.IsNaN(number) && !math.IsInf(number, 0) && (!integer || math.Trunc(number) == number)
	}
	return false
}

func equalSchemaValue(actual, expected any) bool {
	a, err := json.Marshal(actual)
	if err != nil {
		return false
	}
	b, err := json.Marshal(expected)
	if err != nil {
		return false
	}
	if bytes.Equal(a, b) {
		return true
	}
	x, xok := new(big.Rat).SetString(string(a))
	y, yok := new(big.Rat).SetString(string(b))
	return xok && yok && x.Cmp(y) == 0
}
