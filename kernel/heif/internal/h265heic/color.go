package heic

import (
	"github.com/gen2brain/h265/hevc"
)

const (
	mcIdentity  = 0
	mcBT709     = 1
	mcUnspec    = 2
	mcFCC       = 4
	mcBT470BG   = 5
	mcBT601     = 6
	mcSMPTE240  = 7
	mcYCgCo     = 8
	mcBT2020NCL = 9
)

func yuvCoefficients(matrix int) (float32, float32, float32) {
	kr, kb := float32(0.299), float32(0.114)

	switch matrix {
	case mcBT709:
		kr, kb = 0.2126, 0.0722
	case mcFCC:
		kr, kb = 0.30, 0.11
	case mcBT470BG, mcBT601:
		kr, kb = 0.299, 0.114
	case mcSMPTE240:
		kr, kb = 0.212, 0.087
	case mcBT2020NCL:
		kr, kb = 0.2627, 0.0593
	}

	return kr, 1 - kr - kb, kb
}

// planeView is one plane of a decoded picture with the conformance window
// already applied, so the rest of this package never sees the crop.
type planeView struct {
	p8     []uint8
	p16    []uint16
	stride int
	w, h   int
}

func (v planeView) valid() bool { return v.p8 != nil || v.p16 != nil }

func viewOf(p8 []uint8, p16 []uint16, stride, x, y, w, h int) planeView {
	v := planeView{stride: stride, w: w, h: h}

	off := y*stride + x
	if p16 != nil {
		v.p16 = p16[off:]
	} else if p8 != nil {
		v.p8 = p8[off:]
	}

	return v
}

// views returns the luma and chroma planes of pic, cropped to the conformance
// window. Chroma is empty for monochrome.
func views(pic *hevc.Picture) (y, cb, cr planeView) {
	cw, ch := pic.CropW, pic.CropH
	sw, sh := 1, 1

	switch pic.ChromaFormat {
	case 1:
		sw, sh = 2, 2
	case 2:
		sw = 2
	}

	y = viewOf(pic.Y, pic.Y16, pic.StrideY, pic.CropX, pic.CropY, cw, ch)

	if pic.ChromaFormat == 0 {
		return y, cb, cr
	}

	ux, uy := pic.CropX/sw, pic.CropY/sh
	uw, uh := (cw+sw-1)/sw, (ch+sh-1)/sh

	cb = viewOf(pic.Cb, pic.Cb16, pic.StrideC, ux, uy, uw, uh)
	cr = viewOf(pic.Cr, pic.Cr16, pic.StrideC, ux, uy, uw, uh)

	return y, cb, cr
}

type colorState struct {
	matrix     int
	fullRange  bool
	depth      int
	maxChannel int
	outMax     float32

	kr, kg, kb     float32
	crCoef, cbCoef float32
	gcr, gcb       float32

	tableY  []float32
	tableUV []float32
	pixLUT  []uint16

	biasY, rangeY   float32
	biasUV, rangeUV float32

	ssHor, ssVer int
	hasColor     bool
	unsupported  bool

	uvIdx, uvAdj []int
	yRow         []uint16
	uRow, vRow   [2][]uint16
	cbRow, crRow []float32

	yf         []float32
	uPad, vPad [2][]float32
	row        convertRow
	row16      convertRow16
	consts     rowConsts
}

func newColorState(pic *hevc.Picture, ci ColorInfo, outDepth int) *colorState {
	s := &colorState{
		matrix:    int(ci.Matrix),
		fullRange: ci.FullRange,
		depth:     pic.BitDepth,
	}

	if s.matrix == mcUnspec {
		s.matrix = mcBT601
	}

	s.maxChannel = 1<<s.depth - 1
	s.outMax = float32(int(1)<<outDepth - 1)
	s.hasColor = pic.ChromaFormat != 0

	switch pic.ChromaFormat {
	case 1:
		s.ssHor, s.ssVer = 1, 1
	case 2:
		s.ssHor = 1
	}

	s.kr, s.kg, s.kb = yuvCoefficients(s.matrix)

	switch s.matrix {
	case mcIdentity:
		if pic.ChromaFormat != 3 && pic.ChromaFormat != 0 {
			s.unsupported = true
		}
	case mcYCgCo:
		if !s.fullRange {
			s.unsupported = true
		}
	case 3, 10, 11, 12, 13, 14:
		s.unsupported = true
	}

	shift := s.depth - 8

	biasY, rangeY := float32(0), float32(s.maxChannel)
	if !s.fullRange {
		biasY = float32(int(16) << shift)
		rangeY = float32(int(219) << shift)
	}

	biasUV := float32(int(1) << (s.depth - 1))
	rangeUV := float32(s.maxChannel)

	if !s.fullRange {
		rangeUV = float32(int(224) << shift)
	}

	s.biasY, s.rangeY = biasY, rangeY
	s.biasUV, s.rangeUV = biasUV, rangeUV

	n := 1 << s.depth

	s.tableY = make([]float32, n)
	for i := range n {
		s.tableY[i] = (float32(i) - biasY) / rangeY
	}

	if s.matrix == mcIdentity {
		s.tableUV = s.tableY
	} else {
		s.tableUV = make([]float32, n)
		for i := range n {
			s.tableUV[i] = (float32(i) - biasUV) / rangeUV
		}
	}

	s.derive()

	return s
}

// alphaState is the luma-only conversion an alpha auxiliary item needs.
func alphaState(pic *hevc.Picture, outDepth int, full bool) *colorState {
	s := &colorState{
		depth:      pic.BitDepth,
		maxChannel: 1<<pic.BitDepth - 1,
		outMax:     float32(int(1)<<outDepth - 1),
	}

	shift := s.depth - 8

	bias, rng := float32(0), float32(s.maxChannel)
	if !full {
		bias, rng = float32(int(16)<<shift), float32(int(219)<<shift)
	}

	s.biasY, s.rangeY = bias, rng

	n := 1 << s.depth

	s.tableY = make([]float32, n)
	for i := range n {
		s.tableY[i] = (float32(i) - bias) / rng
	}

	s.tableUV = s.tableY
	s.derive()

	return s
}

func (s *colorState) derive() {
	s.pixLUT = make([]uint16, len(s.tableY))
	for i, v := range s.tableY {
		s.pixLUT[i] = uint16(0.5 + clampF(v)*s.outMax)
	}

	s.crCoef, s.cbCoef = 2*(1-s.kr), 2*(1-s.kb)
	s.gcr, s.gcb = s.kr*(1-s.kr), s.kb*(1-s.kb)
}

func clampF(v float32) float32 {
	if v < 0 {
		return 0
	}

	if v > 1 {
		return 1
	}

	return v
}

// prepare sizes the row scratch and precomputes the chroma sample each output
// column interpolates against.
func (s *colorState) prepare(w int) {
	uw := (w + s.ssHor) >> s.ssHor

	s.yRow = make([]uint16, w)

	for i := range s.uRow {
		s.uRow[i] = make([]uint16, uw)
		s.vRow[i] = make([]uint16, uw)
	}

	s.cbRow = make([]float32, w)
	s.crRow = make([]float32, w)

	s.yf = make([]float32, w)

	for i := range s.uPad {
		s.uPad[i] = make([]float32, uw+2)
		s.vPad[i] = make([]float32, uw+2)
	}

	s.uvIdx = make([]int, w)
	s.uvAdj = make([]int, w)

	for x := range w {
		uvX := x >> s.ssHor
		adj := 0

		if x != 0 && !(x == w-1 && x%2 != 0) {
			if x%2 != 0 {
				adj = 1
			} else {
				adj = -1
			}
		}

		s.uvIdx[x] = uvX
		s.uvAdj[x] = min(max(uvX+adj, 0), uw-1)
	}
}

// fillRow copies one row of a plane into 16-bit scratch, which lets the LUTs
// be indexed the same way at every bit depth.
func (s *colorState) fillRow(v planeView, y, n int, dst []uint16) {
	dst = dst[:n]

	if v.p16 != nil {
		row := v.p16[y*v.stride:]
		maxCh := uint16(s.maxChannel)

		for i := range dst {
			dst[i] = min(row[i], maxCh)
		}

		return
	}

	row := v.p8[y*v.stride : y*v.stride+n]
	for i, c := range row {
		dst[i] = uint16(c)
	}
}

func (s *colorState) lumaRow(v planeView, y, w int) []uint16 {
	s.fillRow(v, y, w, s.yRow)

	return s.yRow
}

// chromaRow expands one row of Cb and Cr to full width. 4:2:0 interpolates
// with the 9/3/3/1 weights libavif uses, so both packages upsample alike.
func (s *colorState) chromaRow(cb, cr planeView, y, w, h int) {
	uvY := y >> s.ssVer
	uw := (w + s.ssHor) >> s.ssHor

	s.fillRow(cb, uvY, uw, s.uRow[0])
	s.fillRow(cr, uvY, uw, s.vRow[0])

	tab := s.tableUV
	cbRow, crRow := s.cbRow[:w], s.crRow[:w]

	if s.ssHor == 0 {
		u, v := s.uRow[0][:w], s.vRow[0][:w]

		for x := range cbRow {
			cbRow[x] = tab[u[x]]
			crRow[x] = tab[v[x]]
		}

		return
	}

	adjRow := 0
	if s.ssVer != 0 && y != 0 && !(y == h-1 && y%2 != 0) {
		if y%2 != 0 {
			adjRow = 1
		} else {
			adjRow = -1
		}
	}

	u1, v1 := s.uRow[0], s.vRow[0]

	if adjRow != 0 {
		ay := min(max(uvY+adjRow, 0), cb.h-1)

		s.fillRow(cb, ay, uw, s.uRow[1])
		s.fillRow(cr, ay, uw, s.vRow[1])

		u1, v1 = s.uRow[1], s.vRow[1]
	}

	const w0, w1, w2, w3 = 9.0 / 16.0, 3.0 / 16.0, 3.0 / 16.0, 1.0 / 16.0

	u0, v0 := s.uRow[0], s.vRow[0]

	for x := range w {
		i, j := s.uvIdx[x], s.uvAdj[x]

		cbRow[x] = w0*tab[u0[i]] + w1*tab[u0[j]] + w2*tab[u1[i]] + w3*tab[u1[j]]
		crRow[x] = w0*tab[v0[i]] + w1*tab[v0[j]] + w2*tab[v1[i]] + w3*tab[v1[j]]
	}
}

// rgbRow converts one row to RGB at the output depth.
func (s *colorState) rgbRow(y, cb, cr planeView, row int, dst []uint16) {
	w := y.w
	luma := s.lumaRow(y, row, w)

	if !s.hasColor {
		for x := range w {
			v := s.pixLUT[luma[x]]
			dst[3*x], dst[3*x+1], dst[3*x+2] = v, v, v
		}

		return
	}

	s.chromaRow(cb, cr, row, w, y.h)

	tab := s.tableY
	cbf, crf := s.cbRow, s.crRow

	switch s.matrix {
	case mcIdentity:
		for x := range w {
			g, b, r := tab[luma[x]], cbf[x], crf[x]
			s.store(dst[3*x:], r, g, b)
		}

	case mcYCgCo:
		for x := range w {
			yv, cg, co := tab[luma[x]], cbf[x], crf[x]
			t := yv - cg
			s.store(dst[3*x:], t+co, yv+cg, t-co)
		}

	default:
		for x := range w {
			yv, u, v := tab[luma[x]], cbf[x], crf[x]

			r := yv + s.crCoef*v
			b := yv + s.cbCoef*u
			g := yv - (s.gcr*v+s.gcb*u)*2/s.kg

			s.store(dst[3*x:], r, g, b)
		}
	}
}

func (s *colorState) store(dst []uint16, r, g, b float32) {
	dst[0] = uint16(0.5 + clampF(r)*s.outMax)
	dst[1] = uint16(0.5 + clampF(g)*s.outMax)
	dst[2] = uint16(0.5 + clampF(b)*s.outMax)
}

func (s *colorState) alphaRow(v planeView, row, w int, dst []uint16) {
	luma := s.lumaRow(v, row, w)

	for x := range w {
		dst[x] = s.pixLUT[luma[x]]
	}
}
