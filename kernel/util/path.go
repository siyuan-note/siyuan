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

import (
	"bytes"
	"net"
	"os"
	"os/exec"
	"path"
	"strings"

	"github.com/88250/gulu"
)

var (
	SSL       = false
	UserAgent = "SiYuan/" + Ver
)

const (
	ServerPort          = "6806"                              // HTTP/WebSocket 端口
	AliyunServer        = "https://siyuan-sync.b3logfile.com" // 云端服务地址，阿里云负载均衡，用于接口，数据同步文件上传、下载会走七牛云 OSS http://siyuan-data.b3logfile.com
	BazaarStatServer    = "http://bazaar.b3logfile.com"       // 集市包统计服务地址，直接对接 Bucket 没有 CDN 缓存
	BazaarOSSServer     = "https://oss.b3logfile.com"         // 云端对象存储地址，七牛云，仅用于读取小文件（比如配置 json），不用于读取包内容（如果是订阅会员则用于读取包内容）
	BazaarOSSFileServer = "https://oss0.b3logfile.com"        // 云端对象存储文件服务地址，Cloudflare，用于读取包内容
)

func ShortPathForBootingDisplay(p string) string {
	if 25 > len(p) {
		return p
	}
	p = strings.TrimSuffix(p, ".sy")
	p = path.Base(p)
	return p
}

func IsIDPattern(str string) bool {
	if len("20060102150405-1a2b3c4") != len(str) {
		return false
	}

	if 1 != strings.Count(str, "-") {
		return false
	}

	parts := strings.Split(str, "-")
	idPart := parts[0]
	if 14 != len(idPart) {
		return false
	}

	for _, c := range idPart {
		if !('0' <= c && '9' >= c) {
			return false
		}
	}

	randPart := parts[1]
	if 7 != len(randPart) {
		return false
	}

	for _, c := range randPart {
		if !('a' <= c && 'z' >= c) && !('0' <= c && '9' >= c) {
			return false
		}
	}
	return true
}

var LocalIPs []string

func GetLocalIPs() (ret []string) {
	if "android" == Container {
		// Android 上用不了 net.InterfaceAddrs() https://github.com/golang/go/issues/40569，所以前面使用启动内核传入的参数 localIPs
		LocalIPs = append(LocalIPs, "127.0.0.1")
		LocalIPs = gulu.Str.RemoveDuplicatedElem(LocalIPs)
		return LocalIPs
	}

	ret = []string{}
	addrs, err := net.InterfaceAddrs()
	if nil != err {
		LogWarnf("get interface addresses failed: %s", err)
		return
	}
	for _, addr := range addrs {
		if networkIp, ok := addr.(*net.IPNet); ok && !networkIp.IP.IsLoopback() && networkIp.IP.To4() != nil &&
			bytes.Equal([]byte{255, 255, 255, 0}, networkIp.Mask) {
			ret = append(ret, networkIp.IP.String())
		}
	}
	ret = append(ret, "127.0.0.1")
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func isRunningInDockerContainer() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}

func IsRelativePath(dest string) bool {
	if 1 > len(dest) {
		return true
	}

	if '/' == dest[0] {
		return false
	}
	return !strings.Contains(dest, ":/") && !strings.Contains(dest, ":\\")
}

func TimeFromID(id string) (ret string) {
	ret = id[:14]
	return
}

func IsValidPandocBin(binPath string) bool {
	if "" == binPath {
		return false
	}

	cmd := exec.Command(binPath, "--version")
	CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "pandoc") {
		return true
	}
	return false
}
