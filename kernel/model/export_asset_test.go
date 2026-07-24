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

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestResolveExportAssetPaths(t *testing.T) {
	const (
		imageAsset  = "assets/image%20file-20260724150608-42z1qwz.png"
		videoAsset  = "assets/video file-20260724150608-42z1qwz.webm"
		audioAsset  = "assets/audio file-20260724150608-42z1qwz.wav?box=20260724163822-tfrplrg"
		iframeAsset = "assets/frame file-20260724150608-42z1qwz.html"
	)

	tests := []struct {
		name     string
		removeID bool
		expected map[string][2]string
	}{
		{
			name: "preserve asset IDs",
			expected: map[string][2]string{
				imageAsset:  {imageAsset, imageAsset},
				videoAsset:  {videoAsset, videoAsset},
				audioAsset:  {audioAsset, audioAsset},
				iframeAsset: {iframeAsset, iframeAsset},
			},
		},
		{
			name:     "remove asset IDs",
			removeID: true,
			expected: map[string][2]string{
				"assets/image%20file.png": {imageAsset, "assets/image%20file.png"},
				"assets/video file.webm":  {videoAsset, "assets/video file.webm"},
				"assets/audio file.wav?box=20260724163822-tfrplrg": {
					audioAsset,
					"assets/audio file.wav?box=20260724163822-tfrplrg",
				},
				iframeAsset: {iframeAsset, "assets/frame file.html"},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalConf := Conf
			Conf = NewAppConf()
			Conf.Export = conf.NewExport()
			Conf.Export.RemoveAssetsID = test.removeID
			t.Cleanup(func() {
				Conf = originalConf
			})

			root := &ast.Node{Type: ast.NodeDocument}
			root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(imageAsset)})
			root.AppendChild(&ast.Node{Type: ast.NodeVideo, Tokens: []byte(`<video src="` + videoAsset + `"></video>`)})
			root.AppendChild(&ast.Node{Type: ast.NodeAudio, Tokens: []byte(`<audio src="` + audioAsset + `"></audio>`)})
			root.AppendChild(&ast.Node{Type: ast.NodeIFrame, Tokens: []byte(`<iframe src="` + iframeAsset + `"></iframe>`)})

			assetsOldNew, assetsNewOld := map[string]string{}, map[string]string{}
			tree := &parse.Tree{Root: root}
			removeAssetsID(tree, assetsOldNew, assetsNewOld)

			assets := getAssetsLinkDests(root, false)
			if len(assets) != len(test.expected) {
				t.Fatalf("got %d rendered assets, want %d", len(assets), len(test.expected))
			}
			for _, asset := range assets {
				oldAsset, newAsset := resolveExportAssetPaths(asset, assetsOldNew, assetsNewOld)
				expected, ok := test.expected[asset]
				if !ok {
					t.Fatalf("unexpected rendered asset [%s]", asset)
				}
				if oldAsset != expected[0] || newAsset != expected[1] {
					t.Fatalf("resolve asset [%s]: got [%s, %s], want [%s, %s]",
						asset, oldAsset, newAsset, expected[0], expected[1])
				}
			}
		})
	}
}
