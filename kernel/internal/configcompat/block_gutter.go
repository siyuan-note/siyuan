package configcompat

import "encoding/json"

// BlockGutterMode 保存完整块标开关，并兼容整数配置；仅 1 表示启用，其他整数表示关闭。
type BlockGutterMode bool

func (mode *BlockGutterMode) UnmarshalJSON(data []byte) error {
	var enabled bool
	if err := json.Unmarshal(data, &enabled); err == nil {
		*mode = BlockGutterMode(enabled)
		return nil
	}
	var legacy int
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	*mode = legacy == 1
	return nil
}
