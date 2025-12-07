import type { Overlay } from '../types';

/**
 * Overlay rendering service - builds FFmpeg filter chains for overlays
 */

/**
 * Convert hex color to RGB format for FFmpeg
 */
function hexToRgb(hex: string, opacity: number): string {
  hex = hex.replace(/^#/, '');
  
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    console.warn(`Invalid hex color: ${hex}, using default FF0000`);
    hex = 'FF0000';
  }
  
  const _r = parseInt(hex.substring(0, 2), 16);
  const _g = parseInt(hex.substring(2, 4), 16);
  const _b = parseInt(hex.substring(4, 6), 16);
  
  if (opacity < 1) {
    const alpha = Math.round(opacity * 255);
    const alphaHex = alpha.toString(16).padStart(2, '0');
    return `0x${hex}${alphaHex}`;
  }
  
  return `0x${hex}FF`;
}

/**
 * Build FFmpeg overlay filters for text, image, and shape overlays
 */
export function buildOverlayFilters(
  overlays: Overlay[],
  imagePaths: string[],
  videoDuration: number
): { filterComplex: string; outputStream: string } {
  if (overlays.length === 0) {
    return { filterComplex: '', outputStream: '' };
  }

  const filterParts: string[] = [];
  let imageInputIndex = 1;
  let currentStream = '[0:v]';
  
  const sortedOverlays = [...overlays].sort((a, b) => a.start - b.start);
  
  for (const overlay of sortedOverlays) {
    if (overlay.type === 'text') {
      const fontSize = overlay.fontSize || 24;
      const fontColor = overlay.fontColor || 'white';
      const bgColor = overlay.backgroundColor || 'black@0.5';
      const opacity = overlay.opacity ?? 1;
      const x = `W*${overlay.x}/100`;
      const y = `H*${overlay.y}/100`;
      
      console.log(`[Text Overlay Debug] Received: x=${overlay.x}%, y=${overlay.y}%, text="${overlay.text}"`);
      
      const escapedText = overlay.text
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,');
      
      const enable = `between(t,${overlay.start},${overlay.end})`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      const hasTransparentBg = !bgColor || bgColor === 'transparent' || bgColor === 'none' || bgColor === '';
      if (hasTransparentBg) {
        filterParts.push(
          `${currentStream}drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:x=${x}:y=${y}:enable='${enable}'[${outputLabel}]`
        );
      } else {
        filterParts.push(
          `${currentStream}drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:box=1:boxcolor=${bgColor}:boxborderw=5:x=${x}:y=${y}:enable='${enable}'[${outputLabel}]`
        );
      }
      currentStream = `[${outputLabel}]`;
      
    } else if (overlay.type === 'image' && imageInputIndex - 1 < imagePaths.length) {
      const widthPixels = overlay.width || 200;
      const heightPixels = overlay.height || 200;
      const _opacity = overlay.opacity ?? 1; // TODO: Add opacity support to overlay filter
      
      console.log(`[Image Overlay] id=${overlay.id}, width=${widthPixels}px, height=${heightPixels}px, x=${overlay.x}%, y=${overlay.y}%`);
      
      const x = `W*${overlay.x}/100`;
      const y = `H*${overlay.y}/100`;
      const enable = `between(t,${overlay.start},${overlay.end})`;
      
      const imgInput = `[${imageInputIndex}:v]`;
      const loopedImgLabel = `looped${imageInputIndex}`;
      const scaledImgLabel = `scaled${imageInputIndex}`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      const loopSize = Math.ceil(videoDuration * 30);
      const _currentStreamName = currentStream.replace(/^\[/, '').replace(/\]$/, '');
      
      filterParts.push(
        `${imgInput}loop=loop=-1:size=${loopSize}:start=0[${loopedImgLabel}];[${loopedImgLabel}]scale=w=${widthPixels}:h=${heightPixels}:force_original_aspect_ratio=decrease[${scaledImgLabel}];${currentStream}[${scaledImgLabel}]overlay=${x}:${y}:enable='${enable}'[${outputLabel}]`
      );
      currentStream = `[${outputLabel}]`;
      imageInputIndex++;
      
    } else if (overlay.type === 'shape') {
      const widthPixels = overlay.width || 200;
      const heightPixels = overlay.height || 200;
      console.log(`[Shape Overlay] id=${overlay.id}, width=${widthPixels}px, height=${heightPixels}px, x=${overlay.x}%, y=${overlay.y}%, fill=${overlay.fill || false}`);
      
      const color = overlay.color || '#FF0000';
      const strokeWidth = overlay.strokeWidth || 3;
      const fill = overlay.fill || false;
      const opacity = overlay.opacity ?? 1;
      
      const rgbColor = hexToRgb(color, opacity);
      
      const drawboxX = `iw*${overlay.x}/100`;
      const drawboxY = `ih*${overlay.y}/100`;
      const drawboxWidth = String(widthPixels);
      const drawboxHeight = String(heightPixels);
      
      const enable = `between(t,${overlay.start},${overlay.end})`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      if (fill) {
        filterParts.push(
          `${currentStream}drawbox=x=${drawboxX}:y=${drawboxY}:w=${drawboxWidth}:h=${drawboxHeight}:color=${rgbColor}:t=-1:enable='${enable}'[${outputLabel}]`
        );
      } else {
        filterParts.push(
          `${currentStream}drawbox=x=${drawboxX}:y=${drawboxY}:w=${drawboxWidth}:h=${drawboxHeight}:color=${rgbColor}:t=${strokeWidth}:enable='${enable}'[${outputLabel}]`
        );
      }
      currentStream = `[${outputLabel}]`;
    }
  }
  
  const finalOutputStream = currentStream.replace(/^\[|\]$/g, '');
  console.log(`[buildOverlayFilters] Final output stream: ${finalOutputStream}, filter parts: ${filterParts.length}`);
  return { filterComplex: filterParts.join(';'), outputStream: finalOutputStream };
}

