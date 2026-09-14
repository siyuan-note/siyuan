package apicontract

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
)

func init() {
	endpoint := GetBlockInfo
	GetBlockInfo.decodeRequest = func(reader io.Reader) (BlockInfoRequest, error) {
		request, err := endpoint.Decode(reader)
		var typeError *json.UnmarshalTypeError
		// 块信息入口保留 ID 类型错误的既有消息。
		if errors.As(err, &typeError) && typeError.Type.Kind() == reflect.String {
			return request, errors.New("Field [id] should be of type [String]")
		}
		return request, err
	}
}
