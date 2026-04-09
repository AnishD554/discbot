import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

async function loadImage(pdfDoc, bytes, contentType = "", name = "") {
  const type = (contentType || name).toLowerCase();
  if (type.includes("png")) {
    return pdfDoc.embedPng(bytes);
  }

  if (type.includes("jpg") || type.includes("jpeg")) {
    return pdfDoc.embedJpg(bytes);
  }

  throw new Error(`Unsupported image type for watermark asset: ${contentType || name || "unknown"}`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawTiledText(page, {
  width,
  height,
  font,
  line,
  size,
  rotation,
  opacity,
  color,
  xOffset = 0,
  yOffset = 0
}) {
  const textWidth = font.widthOfTextAtSize(line, size);
  const stepX = Math.max(textWidth + 72, width / 2.05);
  const stepY = Math.max(size * 2.9, height / 3.0);

  for (let x = -width * 0.25 + xOffset; x < width * 1.15; x += stepX) {
    for (let y = -height * 0.15 + yOffset; y < height * 1.15; y += stepY) {
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color,
        opacity,
        rotate: degrees(rotation)
      });
    }
  }
}

export async function watermarkPdf({
  pdfBytes,
  textLines = [],
  overlayAssets = []
}) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const embeddedOverlays = [];
  for (const asset of overlayAssets) {
    embeddedOverlays.push({
      ...asset,
      image: await loadImage(pdfDoc, asset.bytes, asset.contentType, asset.name)
    });
  }

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();

    const tiledSize = clamp(Math.min(width, height) / 11.2, 20, 32);

    for (let i = 0; i < textLines.length; i += 1) {
      const line = textLines[i];
      if (!line) continue;

      drawTiledText(page, {
        width,
        height,
        font,
        line,
        size: tiledSize,
        rotation: -32,
        opacity: i === 0 ? 0.22 : 0.19,
        color: rgb(0.18, 0.18, 0.18),
        xOffset: i * (tiledSize * 2.2),
        yOffset: i * (tiledSize * 1.5)
      });
    }

    if (embeddedOverlays[0]) {
      const overlay = embeddedOverlays[0];
      const dims = overlay.image.scale(1);
      const maxWidth = width * 0.97;
      const maxHeight = height * 0.92;
      const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
      const drawWidth = dims.width * scale;
      const drawHeight = dims.height * scale;

      page.drawImage(overlay.image, {
        x: (width - drawWidth) / 2,
        y: (height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
        opacity: 0.44
      });
    }
  }

  return pdfDoc.save();
}
