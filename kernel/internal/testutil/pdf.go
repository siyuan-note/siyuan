// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package testutil

import (
	"bytes"
	"compress/zlib"
	"fmt"
)

// PDFImageFixture 包含两张位图、一张跨页复用图片、透明蒙版和纯矢量页，不依赖 PDF 提取器生成样本。
// secondFilter 可用于构造编码不受支持的第二张图片，空值使用 FlateDecode。
func PDFImageFixture(secondFilter string) []byte {
	if secondFilter == "" {
		secondFilter = "FlateDecode"
	}
	compressed := func(data []byte) []byte {
		var out bytes.Buffer
		w := zlib.NewWriter(&out)
		_, _ = w.Write(data)
		_ = w.Close()
		return out.Bytes()
	}
	stream := func(dict string, data []byte) []byte {
		return append(append(fmt.Appendf(nil, "<< %s /Length %d >>\nstream\n", dict, len(data)), data...), []byte("\nendstream")...)
	}
	objects := [][]byte{
		[]byte("<< /Type /Catalog /Pages 2 0 R >>"),
		[]byte("<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"),
		[]byte("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im1 6 0 R /Im2 7 0 R >> >> /Contents 8 0 R >>"),
		[]byte("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Rotate 90 /Resources << /XObject << /Im1 6 0 R >> >> /Contents 9 0 R >>"),
		[]byte("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 10 0 R >>"),
		stream("/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", compressed(bytes.Repeat([]byte{255, 0, 0}, 6))),
		stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 11 0 R /Filter /"+secondFilter, compressed(bytes.Repeat([]byte{0, 0, 255}, 4))),
		stream("", []byte("q 80 0 0 80 0 0 cm /Im1 Do Q q 60 0 0 60 100 100 cm /Im2 Do Q")),
		stream("", []byte("q 200 0 0 200 0 0 cm /Im1 Do Q")),
		stream("", []byte("0 0 1 RG 10 10 180 180 re S")),
		stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", compressed([]byte{0, 64, 128, 255})),
	}
	var out bytes.Buffer
	out.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objects)+1)
	for i, object := range objects {
		offsets[i+1] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n", i+1)
		out.Write(object)
		out.WriteString("\nendobj\n")
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return out.Bytes()
}
