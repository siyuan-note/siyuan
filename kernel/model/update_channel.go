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

package model

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type globalUpdateConf struct {
	Channel string `json:"channel"`
}

func loadGlobalUpdateChannel() string {
	configPath := globalUpdateConfPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogWarnf("read update channel config [%s] failed: %s", configPath, err)
		}
		return conf.UpdateChannelStable
	}

	config := &globalUpdateConf{}
	if err = gulu.JSON.UnmarshalJSON(data, config); err != nil {
		logging.LogWarnf("parse update channel config [%s] failed: %s", configPath, err)
		return conf.UpdateChannelStable
	}
	if !isValidUpdateChannel(config.Channel) {
		logging.LogWarnf("invalid update channel [%s], using stable channel", config.Channel)
		return conf.UpdateChannelStable
	}
	return config.Channel
}

// SetUpdateChannel 校验并保存应用级更新通道。
func SetUpdateChannel(channel string) error {
	if !isValidUpdateChannel(channel) {
		return errors.New("update channel is invalid")
	}

	data, err := gulu.JSON.MarshalIndentJSON(&globalUpdateConf{Channel: channel}, "", "  ")
	if err != nil {
		return err
	}
	configPath := globalUpdateConfPath()
	if err = os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return err
	}
	if err = filelock.WriteFile(configPath, data); err != nil {
		return err
	}
	Conf.System.UpdateChannel = channel
	return nil
}

func globalUpdateConfPath() string {
	return filepath.Join(util.HomeDir, ".config", "siyuan", "update.json")
}

func isValidUpdateChannel(channel string) bool {
	return conf.UpdateChannelStable == channel || conf.UpdateChannelBeta == channel || conf.UpdateChannelAlpha == channel
}
