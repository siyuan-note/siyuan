//go:build noasm || (!amd64 && !arm64 && !(riscv64 && riscv64.rva23u64))

package heic

func rowFn(ssHor int) convertRow {
	if ssHor == 0 {
		return convertRow444Go
	}

	return convertRowGo
}

func rowFn16(ssHor int) convertRow16 {
	if ssHor == 0 {
		return convertRow16x444Go
	}

	return convertRow16Go
}

func normRow(dst []float32, src []uint8, bias, rng float32) {
	normRowGo(dst, src, bias, rng)
}

func normRow16(dst []float32, src []uint16, maxCh uint16, bias, rng float32) {
	normRow16Go(dst, src, maxCh, bias, rng)
}
