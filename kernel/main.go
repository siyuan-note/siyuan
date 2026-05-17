// SiYuan - Refactor your thinking
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

//go:build !mobile

package main

import (
	"os"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/cli/cmd"
)

func main() {
	// Auto-detect: --flag style args → kernel serve mode
	if len(os.Args) > 1 && strings.HasPrefix(os.Args[1], "-") {
		switch os.Args[1] {
		case "--help", "-h", "--version", "-v":
			// let cobra handle these
		default:
			os.Args = append([]string{os.Args[0], "serve"}, os.Args[1:]...)
		}
	}
	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
