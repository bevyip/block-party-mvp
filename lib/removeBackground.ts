function toDrawableImageSrc(src: string): string {
  const s = src.trim();
  if (
    s.startsWith("data:") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("blob:") ||
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../")
  ) {
    return s;
  }
  return `data:image/png;base64,${s}`;
}

export function removeBackground(base64: string): Promise<string> {
  const drawable = toDrawableImageSrc(base64);
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => {
      /** Image failed to load — return original so callers can still present the sprite. */
      resolve(drawable);
    };
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;
      const visited = new Uint8Array(width * height);

      // A pixel is considered background if it is
      // near-black OR near-white
      function isBackground(idx: number): boolean {
        const r = data[idx]!;
        const g = data[idx + 1]!;
        const b = data[idx + 2]!;
        const isNearBlack = r < 40 && g < 40 && b < 40;
        const isNearWhite = r > 215 && g > 215 && b > 215;
        return isNearBlack || isNearWhite;
      }

      // Flood fill from a seed pixel using a stack.
      // Only removes pixels reachable from image borders.
      function floodFill(startX: number, startY: number): void {
        const startIdx = (startY * width + startX) * 4;
        if (visited[startY * width + startX]) return;
        if (!isBackground(startIdx)) return;

        const stack: number[] = [startY * width + startX];

        while (stack.length > 0) {
          const pixel = stack.pop()!;
          if (visited[pixel]) continue;
          visited[pixel] = 1;

          const idx = pixel * 4;
          if (!isBackground(idx)) continue;

          // Make this pixel transparent
          data[idx + 3] = 0;

          const x = pixel % width;
          const y = Math.floor(pixel / width);

          if (x > 0) stack.push(pixel - 1);
          if (x < width - 1) stack.push(pixel + 1);
          if (y > 0) stack.push(pixel - width);
          if (y < height - 1) stack.push(pixel + width);
        }
      }

      // Seed from all 4 edges.
      // Only border-connected background gets removed.
      for (let x = 0; x < width; x++) {
        floodFill(x, 0); // top edge
        floodFill(x, height - 1); // bottom edge
      }
      for (let y = 0; y < height; y++) {
        floodFill(0, y); // left edge
        floodFill(width - 1, y); // right edge
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };

    img.src = drawable;
  });
}
