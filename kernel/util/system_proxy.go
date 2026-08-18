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

package util

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

type systemNetworkProxyConfig struct {
	HTTPProxy  string
	HTTPSProxy string
	NoProxy    string
}

var loadSystemNetworkProxy = readSystemNetworkProxy

func parseSystemNetworkProxy(proxyServer, proxyOverride string) (*systemNetworkProxyConfig, error) {
	proxyServer = strings.TrimSpace(proxyServer)
	if "" == proxyServer {
		return nil, nil
	}

	ret := &systemNetworkProxyConfig{NoProxy: parseSystemNetworkProxyBypass(proxyOverride)}
	if !strings.Contains(proxyServer, "=") {
		proxyURL, err := normalizeSystemNetworkProxyURL(proxyServer, "http")
		if err != nil {
			return nil, err
		}
		ret.HTTPProxy, ret.HTTPSProxy = proxyURL, proxyURL
		return ret, nil
	}

	proxies := map[string]string{}
	for _, field := range strings.Split(proxyServer, ";") {
		parts := strings.SplitN(field, "=", 2)
		if 2 != len(parts) {
			continue
		}
		name, address := strings.ToLower(strings.TrimSpace(parts[0])), strings.TrimSpace(parts[1])
		if "" != address {
			proxies[name] = address
		}
	}

	var err error
	if address := proxies["http"]; "" != address {
		if ret.HTTPProxy, err = normalizeSystemNetworkProxyURL(address, "http"); err != nil {
			return nil, err
		}
	}
	if address := proxies["https"]; "" != address {
		if ret.HTTPSProxy, err = normalizeSystemNetworkProxyURL(address, "http"); err != nil {
			return nil, err
		}
	}
	socksAddress := proxies["socks5"]
	if "" == socksAddress {
		socksAddress = proxies["socks"]
	}
	if "" != socksAddress {
		socksProxy, parseErr := normalizeSystemNetworkProxyURL(socksAddress, "socks5")
		if parseErr != nil {
			return nil, parseErr
		}
		if "" == ret.HTTPProxy {
			ret.HTTPProxy = socksProxy
		}
		if "" == ret.HTTPSProxy {
			ret.HTTPSProxy = socksProxy
		}
	}
	if "" == ret.HTTPProxy && "" == ret.HTTPSProxy {
		return nil, fmt.Errorf("system proxy does not contain a supported HTTP, HTTPS or SOCKS proxy")
	}
	return ret, nil
}

func normalizeSystemNetworkProxyURL(address, defaultScheme string) (string, error) {
	address = strings.TrimSpace(address)
	if !strings.Contains(address, "://") {
		address = defaultScheme + "://" + address
	}
	proxyURL, err := url.Parse(address)
	if err != nil || "" == proxyURL.Host {
		return "", fmt.Errorf("invalid system proxy address")
	}
	switch strings.ToLower(proxyURL.Scheme) {
	case "http", "https", "socks5", "socks5h":
	default:
		return "", fmt.Errorf("unsupported system proxy protocol [%s]", proxyURL.Scheme)
	}
	return proxyURL.String(), nil
}

func parseSystemNetworkProxyBypass(proxyOverride string) string {
	entries := []string{}
	seen := map[string]bool{}
	add := func(entry string) {
		if "" != entry && !seen[entry] {
			entries = append(entries, entry)
			seen[entry] = true
		}
	}
	for _, field := range strings.Split(proxyOverride, ";") {
		field = strings.TrimSpace(field)
		if strings.EqualFold(field, "<local>") {
			add("localhost")
			add("127.0.0.1")
			add("::1")
			continue
		}
		if cidr, ok := systemNetworkProxyWildcardCIDR(field); ok {
			add(cidr)
			continue
		}
		add(field)
	}
	return strings.Join(entries, ",")
}

func systemNetworkProxyWildcardCIDR(pattern string) (string, bool) {
	parts := strings.Split(pattern, ".")
	if len(parts) < 2 || 4 < len(parts) || "*" != parts[len(parts)-1] {
		return "", false
	}
	fixed := len(parts) - 1
	for i, part := range parts {
		if i >= fixed {
			if "*" != part {
				return "", false
			}
			continue
		}
		value, err := strconv.Atoi(part)
		if err != nil || value < 0 || 255 < value {
			return "", false
		}
	}
	addressParts := append([]string{}, parts[:fixed]...)
	for len(addressParts) < 4 {
		addressParts = append(addressParts, "0")
	}
	cidr := strings.Join(addressParts, ".") + "/" + strconv.Itoa(fixed*8)
	if _, _, err := net.ParseCIDR(cidr); err != nil {
		return "", false
	}
	return cidr, true
}
