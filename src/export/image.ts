async function shareOrDownload(blob: Blob, filename: string) {
  const type = blob.type || "image/png";
  const file = new File([blob], filename, { type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // fall through to download if the user cancels or share fails
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );
}

export async function exportCanvasPng(canvas: HTMLCanvasElement, filename = "painting.png") {
  await shareOrDownload(await canvasToBlob(canvas), filename);
}

async function sourceToCanvas(src: Blob | string): Promise<HTMLCanvasElement> {
  const img = new Image();
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

// src: full-res blob when the piece has one, else its thumbnail data URL
export async function exportImagePng(src: Blob | string, filename = "painting.png") {
  if (typeof src !== "string" && src.type === "image/png") {
    await shareOrDownload(src, filename);
    return;
  }
  const canvas = await sourceToCanvas(src);
  await shareOrDownload(await canvasToBlob(canvas), filename);
}

export async function exportImageJpg(src: Blob | string, filename = "painting.jpg") {
  const canvas = await sourceToCanvas(src);
  await shareOrDownload(await canvasToBlob(canvas, "image/jpeg", 0.92), filename);
}
