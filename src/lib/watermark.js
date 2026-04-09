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
  const stepX = Math.max(textWidth + 120, width / 1.95);
  const stepY = Math.max(size * 4.2, height / 2.9);

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

    const tiledSize = clamp(Math.min(width, height) / 12.5, 16, 28);

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
        opacity: i === 0 ? 0.1 : 0.085,
        color: rgb(0.14, 0.14, 0.14),
        xOffset: i * (tiledSize * 4.2),
        yOffset: i * (tiledSize * 2.6)
      });
    }

    if (embeddedOverlays[0]) {
      const overlay = embeddedOverlays[0];
      const dims = overlay.image.scale(1);
      const maxWidth = width * 0.88;
      const maxHeight = height * 0.84;
      const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
      const drawWidth = dims.width * scale;
      const drawHeight = dims.height * scale;

      page.drawImage(overlay.image, {
        x: (width - drawWidth) / 2,
        y: (height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
        opacity: 0.28
      });
    }
  }

  return pdfDoc.save();
}
