package heic

import (
	"image"
	"image/color"

	"github.com/gen2brain/h265/hevc"
)

func colorModelFor(f *file, it *item) color.Model {
	return color.NRGBAModel
}

func (f *file) colorInfo(it *item, pic *hevc.Picture) ColorInfo {
	ci := ColorInfo{Matrix: mcUnspec, Primaries: 2, Transfer: 2}

	p := f.meta.prop(it, "colr")
	if p == nil || p.colr == nil {
		return ci
	}

	if p.colr.hasNCLX {
		ci.Primaries = p.colr.primaries
		ci.Transfer = p.colr.transfer
		ci.Matrix = p.colr.matrix
		ci.FullRange = p.colr.fullRange
	}

	ci.ICCP = p.colr.icc

	return ci
}

// aliasesPicture reports whether img shares memory with the decoded planes.
func aliasesPicture(img image.Image) bool {
	switch img.(type) {
	case *image.YCbCr, *image.NYCbCrA, *image.Gray:
		return true
	}

	return false
}

// planar wraps the decoded planes without converting them, which is what the
// bitstream already holds.
func planar(pic, alpha *hevc.Picture) (image.Image, bool) {
	if pic.BitDepth != 8 {
		return nil, false
	}

	y, cb, cr := views(pic)
	rect := image.Rect(0, 0, pic.CropW, pic.CropH)

	if pic.ChromaFormat == 0 {
		if alpha != nil {
			return nil, false
		}

		return &image.Gray{Pix: y.p8, Stride: y.stride, Rect: rect}, true
	}

	var ratio image.YCbCrSubsampleRatio

	switch pic.ChromaFormat {
	case 1:
		ratio = image.YCbCrSubsampleRatio420
	case 2:
		ratio = image.YCbCrSubsampleRatio422
	case 3:
		ratio = image.YCbCrSubsampleRatio444
	default:
		return nil, false
	}

	yc := image.YCbCr{
		Y: y.p8, Cb: cb.p8, Cr: cr.p8,
		YStride: y.stride, CStride: cb.stride,
		SubsampleRatio: ratio, Rect: rect,
	}

	if alpha == nil {
		return &yc, true
	}

	if alpha.BitDepth != 8 || alpha.ChromaFormat != 0 {
		return nil, false
	}

	ay, _, _ := views(alpha)
	if ay.w != pic.CropW || ay.h != pic.CropH {
		return nil, false
	}

	return &image.NYCbCrA{YCbCr: yc, A: ay.p8, AStride: ay.stride}, true
}

func toImage(pic, alpha *hevc.Picture, ci ColorInfo, ycbcr bool) (image.Image, error) {
	if ycbcr {
		if img, ok := planar(pic, alpha); ok {
			return img, nil
		}
	}

	const outDepth = 8

	cs := newColorState(pic, ci, outDepth)
	if cs.unsupported {
		return nil, ErrUnsupported
	}

	y, cb, cr := views(pic)
	if !y.valid() {
		return nil, ErrInvalid
	}

	w, h := y.w, y.h
	rect := image.Rect(0, 0, w, h)

	cs.prepare(w)

	if cs.fastRow(outDepth) {
		cs.consts = cs.rowConsts()

		if outDepth == 8 {
			cs.row = rowFn(cs.ssHor)
		} else {
			cs.row16 = rowFn16(cs.ssHor)
		}
	}

	var (
		as *colorState
		av planeView
	)

	if alpha != nil {
		// An auxiliary alpha image carries its values in the luma channel, so
		// chroma planes are padding whatever the file codes them as.
		av, _, _ = views(alpha)
		if av.w != w || av.h != h {
			return nil, ErrUnsupported
		}

		as = alphaState(alpha, outDepth, true)
		as.prepare(w)
	}

	rgb := make([]uint16, 3*w)
	aRow := make([]uint16, w)

	if as == nil {
		for x := range aRow {
			aRow[x] = uint16(cs.outMax)
		}
	}

	if outDepth == 8 {
		dst := image.NewNRGBA(rect)

		if cs.row != nil {
			ab := make([]uint8, w)
			for i := range ab {
				ab[i] = 0xff
			}

			for row := range h {
				if as != nil {
					as.alphaRow(av, row, w, aRow)

					for i, v := range aRow {
						ab[i] = uint8(v)
					}
				}

				u0, u1, v0, v1 := cs.rowPlanes(cb, cr, row, w, h)
				cs.row(dst.Pix[row*dst.Stride:], cs.lumaRowF(y, row, w),
					u0, u1, v0, v1, ab, w, &cs.consts)
			}

			return dst, nil
		}

		for row := range h {
			cs.rgbRow(y, cb, cr, row, rgb)

			if as != nil {
				as.alphaRow(av, row, w, aRow)
			}

			o := row * dst.Stride
			for x := range w {
				dst.Pix[o] = uint8(rgb[3*x])
				dst.Pix[o+1] = uint8(rgb[3*x+1])
				dst.Pix[o+2] = uint8(rgb[3*x+2])
				dst.Pix[o+3] = uint8(aRow[x])
				o += 4
			}
		}

		return dst, nil
	}

	dst := image.NewNRGBA64(rect)

	if cs.row16 != nil {
		for row := range h {
			if as != nil {
				as.alphaRow(av, row, w, aRow)
			}

			u0, u1, v0, v1 := cs.rowPlanes(cb, cr, row, w, h)
			cs.row16(dst.Pix[row*dst.Stride:], cs.lumaRowF(y, row, w),
				u0, u1, v0, v1, aRow, w, &cs.consts)
		}

		return dst, nil
	}

	for row := range h {
		cs.rgbRow(y, cb, cr, row, rgb)

		if as != nil {
			as.alphaRow(av, row, w, aRow)
		}

		o := row * dst.Stride
		for x := range w {
			r, g, b, a := rgb[3*x], rgb[3*x+1], rgb[3*x+2], aRow[x]

			dst.Pix[o] = uint8(r >> 8)
			dst.Pix[o+1] = uint8(r)
			dst.Pix[o+2] = uint8(g >> 8)
			dst.Pix[o+3] = uint8(g)
			dst.Pix[o+4] = uint8(b >> 8)
			dst.Pix[o+5] = uint8(b)
			dst.Pix[o+6] = uint8(a >> 8)
			dst.Pix[o+7] = uint8(a)
			o += 8
		}
	}

	return dst, nil
}
