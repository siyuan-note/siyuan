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

package model

import "github.com/siyuan-note/siyuan/kernel/util"

func getCloudServer() string {
	if 0 == Conf.CloudRegion {
		return util.ChinaServer
	}
	return util.NorthAmericaServer
}

func getCloudWebSocketServer() string {
	if 0 == Conf.CloudRegion {
		return util.ChinaWebSocketServer
	}
	return util.NorthAmericaWebSocketServer
}

func getCloudSyncServer() string {
	if 0 == Conf.CloudRegion {
		return util.ChinaSyncServer
	}
	return util.NorthAmericaSyncServer
}

func getCloudAssetsServer() string {
	if 0 == Conf.CloudRegion {
		return util.ChinaCloudAssetsServer
	}
	return util.NorthAmericaCloudAssetsServer
}

func getCloudAccountServer() string {
	if 0 == Conf.CloudRegion {
		return util.ChinaAccountServer
	}
	return util.NorthAmericaAccountServer
}
