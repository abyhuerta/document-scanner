import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { getStorage, ref } from 'firebase/storage';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage as firebaseStorage, db as firebaseDB } from '../firebase';
import { uploadBytes } from 'firebase/storage';
import { ProcessedDoc } from '../models/ProcessedDoc';
import { Status } from '../enum/Status';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import jsPDF from 'jspdf';

type ScanStatus = 'idle' | 'processing' | 'done' | 'error' | 'manual';

@Component({
  selector: 'app-upload-file-component',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    FormsModule,
  ],
  templateUrl: './upload-file-component.html',
  styleUrl: './upload-file-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadFileComponent {
  private storage = getStorage();
  documentsCol = collection(firebaseDB, 'users/test-user/documents');
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  originalImgUrl = signal<string>('');
  isProcessing = signal<boolean>(false);
  scanStatus = signal<ScanStatus>('idle');
  blurryWarning = signal<boolean>(false);

  selectedFile: File | null = null;
  scanner: any;
  comment = '';
  category = '';
  docName = '';

  // Manual corner selection — positions stored in natural image coordinates
  private corners: { x: number; y: number }[] = [];
  private dragIndex = -1;
  private readonly HANDLE_RADIUS = 18;

  @ViewChild('originalImg') originalImg!: ElementRef<HTMLImageElement>;
  @ViewChild('resultContainer') resultContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('cornerCanvas') cornerCanvas!: ElementRef<HTMLCanvasElement>;

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    this.selectedFile = file;
    this.scanStatus.set('idle');
    this.blurryWarning.set(false);

    const url = URL.createObjectURL(file);
    this.originalImgUrl.set(url);

    if (this.resultContainer?.nativeElement) {
      this.resultContainer.nativeElement.innerHTML = '';
    }
    this.originalImg.nativeElement.src = url;

    setTimeout(() => this.processImage(), 100);
  }

  // ─── Step 1: Perspective correction (document detection) ──────────────────

  async processImage() {
    if (!this.originalImg) return;

    this.scanStatus.set('processing');
    this.cdr.markForCheck();

    if (!this.scanner) {
      if (!(window as any).jscanify) {
        console.error('jscanify is not loaded');
        this.scanStatus.set('error');
        this.cdr.markForCheck();
        return;
      }
      this.scanner = new (window as any).jscanify();
    }

    setTimeout(() => {
      try {
        const img = this.originalImg.nativeElement;

        // Draw at natural resolution so jscanify sees full detail
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = img.naturalWidth;
        sourceCanvas.height = img.naturalHeight;
        sourceCanvas.getContext('2d')!.drawImage(img, 0, 0);

        // Check blurriness before perspective warp (variance of Laplacian)
        if (this.detectBlurriness(sourceCanvas) < 50) {
          this.blurryWarning.set(true);
        }

        let resultCanvas: HTMLCanvasElement;
        try {
          // ── Validate detected corners BEFORE warping ──────────────────────
          // jscanify can find a quad that is geometrically wrong for photos where
          // the document colour is close to the background (e.g. white paper on
          // white surface).  Forcing such a quad into A4 output produces a badly
          // distorted result.  We detect this early and fall back to manual mode.
          const contour = this.scanner.findPaperContour(sourceCanvas);
          if (!contour || contour.rows === 0) {
            throw new Error('No document contour found');
          }
          const pts = this.scanner.getCornerPoints(contour);
          const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = pts;

          if (!this.isValidDocumentQuad(tl, tr, br, bl, img.naturalWidth, img.naturalHeight)) {
            // Pre-seed manual corners with the detected (bad) points so the user
            // can see where jscanify went wrong and drag to correct them.
            this.corners = [tl, tr, br, bl];
            throw new Error('Detected quad is too distorted — corners rejected');
          }

          const sourceIsLandscape = img.naturalWidth > img.naturalHeight;

          if (sourceIsLandscape) {
            // Extract at landscape dims then rotate 90° CCW → portrait output
            const landscape = this.scanner.extractPaper(sourceCanvas, 3508, 2480);
            resultCanvas = document.createElement('canvas');
            resultCanvas.width = 2480;
            resultCanvas.height = 3508;
            const rctx = resultCanvas.getContext('2d')!;
            rctx.translate(2480 / 2, 3508 / 2);
            rctx.rotate(-Math.PI / 2);
            rctx.drawImage(landscape, -3508 / 2, -2480 / 2);
          } else {
            resultCanvas = this.scanner.extractPaper(sourceCanvas, 2480, 3508);
          }

          // Validate: if extraction looks blank, jscanify found no document
          if (this.isBlankCanvas(resultCanvas)) {
            throw new Error('Document not detected — blank result');
          }
        } catch (extractErr) {
          console.warn('Auto-detection failed, falling back to manual mode:', extractErr);
          this.initManualMode();
          this.cdr.markForCheck();
          return;
        }

        this.resultContainer.nativeElement.innerHTML = '';
        this.resultContainer.nativeElement.appendChild(resultCanvas);

        // Steps 2–4: grayscale → sharpen → adaptive threshold → deskew
        this.applyFilter(resultCanvas, 'bw');
        this.deskewCanvas(resultCanvas);

        this.scanStatus.set('done');
        this.cdr.markForCheck();
      } catch (err) {
        console.error('Processing error:', err);
        this.scanStatus.set('error');
        this.cdr.markForCheck();
      }
    }, 100);
  }

  // ─── Blurriness detection — variance of Laplacian (lower = blurrier) ──────

  private detectBlurriness(canvas: HTMLCanvasElement): number {
    const scale = 4;
    const sw = Math.floor(canvas.width / scale);
    const sh = Math.floor(canvas.height / scale);
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    small.getContext('2d')!.drawImage(canvas, 0, 0, sw, sh);
    const d = small.getContext('2d')!.getImageData(0, 0, sw, sh).data;

    let sum = 0,
      sum2 = 0,
      n = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = (y * sw + x) * 4;
        const lap =
          4 * d[i] - d[i - 4] - d[i + 4] - d[(y - 1) * sw * 4 + x * 4] - d[(y + 1) * sw * 4 + x * 4];
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    const mean = sum / n;
    return sum2 / n - mean * mean; // variance
  }

  // ─── Blank-canvas check — extraction failure produces near-white output ───

  private isBlankCanvas(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d')!;
    const d = ctx.getImageData(0, 0, Math.min(200, canvas.width), Math.min(200, canvas.height)).data;
    let total = 0;
    const pixels = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      total += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const avg = total / pixels;
    return avg < 5; // white paper is valid; only flag all-black (extraction failed)
  }

  // ─── Quad validation — reject corners that would produce a bad warp ────────
  //
  // Three checks must all pass:
  //   1. Area  — the quad covers ≥15 % of the image (not a tiny stray contour)
  //   2. Aspect ratio — width/height is plausible for a portrait or landscape doc
  //   3. Angles — every interior corner is within 35° of 90° (roughly rectangular)

  private isValidDocumentQuad(
    tl: { x: number; y: number },
    tr: { x: number; y: number },
    br: { x: number; y: number },
    bl: { x: number; y: number },
    imgW: number,
    imgH: number,
  ): boolean {
    // 1. Area (shoelace formula)
    const area =
      0.5 *
      Math.abs(
        tl.x * (tr.y - bl.y) +
          tr.x * (br.y - tl.y) +
          br.x * (bl.y - tr.y) +
          bl.x * (tl.y - br.y),
      );
    if (area < imgW * imgH * 0.15) return false;

    // 2. Aspect ratio of the detected quad
    const avgW = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
    const avgH = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
    if (avgH < 1) return false;
    const ar = avgW / avgH;
    const isPortrait = imgH >= imgW;
    if (isPortrait  && (ar < 0.45 || ar > 1.15)) return false;
    if (!isPortrait && (ar < 0.87 || ar > 2.25)) return false;

    // 3. Interior angles (55°–125° = within 35° of a right angle)
    const corners = [tl, tr, br, bl];
    for (let i = 0; i < 4; i++) {
      const prev = corners[(i + 3) % 4];
      const curr = corners[i];
      const next = corners[(i + 1) % 4];
      const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
      const v2 = { x: next.x - curr.x, y: next.y - curr.y };
      const len1 = Math.hypot(v1.x, v1.y);
      const len2 = Math.hypot(v2.x, v2.y);
      if (len1 < 20 || len2 < 20) return false;
      const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
      if (angle < 55 || angle > 125) return false;
    }

    return true;
  }

  // ─── Manual corner selection fallback ─────────────────────────────────────

  private initManualMode(): void {
    this.scanStatus.set('manual');
    const img = this.originalImg.nativeElement;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    // Place default corners 10% inset from each image corner
    const mx = nw * 0.1,
      my = nh * 0.1;
    this.corners = [
      { x: mx, y: my }, // TL
      { x: nw - mx, y: my }, // TR
      { x: nw - mx, y: nh - my }, // BR
      { x: mx, y: nh - my }, // BL
    ];

    // Wait for the canvas element to become visible in the DOM
    setTimeout(() => {
      const cvEl = this.cornerCanvas?.nativeElement;
      if (!cvEl) return;

      // Canvas pixel buffer = natural image dimensions (drawing is in natural coords)
      cvEl.width = nw;
      cvEl.height = nh;

      // Scale the CSS display size to fit the modal viewport
      const maxW = window.innerWidth * 0.96;
      const maxH = window.innerHeight * 0.75; // leave room for header + footer
      const scale = Math.min(maxW / nw, maxH / nh, 1);
      cvEl.style.width  = Math.round(nw * scale) + 'px';
      cvEl.style.height = Math.round(nh * scale) + 'px';

      this.drawCornerOverlay();
      this.cdr.markForCheck();
    }, 50);
  }

  private drawCornerOverlay(): void {
    const cvEl = this.cornerCanvas?.nativeElement;
    if (!cvEl) return;
    const ctx = cvEl.getContext('2d')!;
    const w = cvEl.width,
      h = cvEl.height;

    // Draw the source image directly onto the canvas — avoids relying on a
    // separate <img> element that may not have loaded yet in the modal.
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.originalImg.nativeElement, 0, 0, w, h);

    // Dark overlay over the whole canvas
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);

    // Redraw the image inside the quad only, effectively removing the overlay
    // inside the selection so the user can see the document content clearly.
    ctx.save();
    ctx.beginPath();
    this.corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(this.originalImg.nativeElement, 0, 0, w, h);
    ctx.restore();

    // Quad border
    ctx.beginPath();
    this.corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.strokeStyle = '#06fd6d';
    ctx.lineWidth = Math.max(4, w * 0.003);
    ctx.stroke();

    // Corner handles
    const labels = ['TL', 'TR', 'BR', 'BL'];
    const r = Math.max(this.HANDLE_RADIUS, w * 0.012);
    this.corners.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#06fd6d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2, w * 0.001);
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(12, Math.floor(r * 0.8))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], c.x, c.y);
    });
  }

  // Convert a mouse event into canvas pixel coordinates (natural image space)
  private eventToCanvasPos(clientX: number, clientY: number): { x: number; y: number } {
    const el = this.cornerCanvas.nativeElement;
    const rect = el.getBoundingClientRect();
    const scaleX = el.width / rect.width;
    const scaleY = el.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  private findNearestCorner(pos: { x: number; y: number }): number {
    const el = this.cornerCanvas.nativeElement;
    const threshold = (el.width / el.getBoundingClientRect().width) * this.HANDLE_RADIUS * 2.5;
    let best = -1,
      bestDist = threshold;
    this.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - pos.x, c.y - pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  onCornerMouseDown(event: MouseEvent): void {
    this.dragIndex = this.findNearestCorner(this.eventToCanvasPos(event.clientX, event.clientY));
  }

  onCornerMouseMove(event: MouseEvent): void {
    if (this.dragIndex < 0) return;
    event.preventDefault();
    const pos = this.eventToCanvasPos(event.clientX, event.clientY);
    const img = this.originalImg.nativeElement;
    this.corners[this.dragIndex] = {
      x: Math.max(0, Math.min(img.naturalWidth, pos.x)),
      y: Math.max(0, Math.min(img.naturalHeight, pos.y)),
    };
    this.drawCornerOverlay();
  }

  onCornerTouchStart(event: TouchEvent): void {
    event.preventDefault();
    const t = event.touches[0];
    this.dragIndex = this.findNearestCorner(this.eventToCanvasPos(t.clientX, t.clientY));
  }

  onCornerTouchMove(event: TouchEvent): void {
    if (this.dragIndex < 0) return;
    event.preventDefault();
    const t = event.touches[0];
    const pos = this.eventToCanvasPos(t.clientX, t.clientY);
    const img = this.originalImg.nativeElement;
    this.corners[this.dragIndex] = {
      x: Math.max(0, Math.min(img.naturalWidth, pos.x)),
      y: Math.max(0, Math.min(img.naturalHeight, pos.y)),
    };
    this.drawCornerOverlay();
  }

  onCornerPointerUp(): void {
    this.dragIndex = -1;
  }

  cancelManualMode(): void {
    this.scanStatus.set('idle');
    this.cdr.markForCheck();
  }

  // Apply the manually-placed corners using OpenCV.js perspective warp
  applyManualCorners(): void {
    const cv = (window as any).cv;
    if (!cv?.getPerspectiveTransform) {
      console.error('OpenCV.js is not ready yet');
      this.scanStatus.set('error');
      this.cdr.markForCheck();
      return;
    }

    const img = this.originalImg.nativeElement;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.naturalWidth;
    srcCanvas.height = img.naturalHeight;
    srcCanvas.getContext('2d')!.drawImage(img, 0, 0);

    const W = 2480,
      H = 3508; // A4 at 300 dpi

    try {
      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, this.corners.flatMap(c => [c.x, c.y]));
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
      const src = cv.imread(srcCanvas);
      const M = cv.getPerspectiveTransform(srcPts, dstPts);
      const dst = new cv.Mat();
      cv.warpPerspective(src, dst, M, new cv.Size(W, H));

      const resultCanvas = document.createElement('canvas');
      resultCanvas.width = W;
      resultCanvas.height = H;
      cv.imshow(resultCanvas, dst);

      src.delete();
      dst.delete();
      M.delete();
      srcPts.delete();
      dstPts.delete();

      this.resultContainer.nativeElement.innerHTML = '';
      this.resultContainer.nativeElement.appendChild(resultCanvas);
      this.applyFilter(resultCanvas, 'bw');
      this.deskewCanvas(resultCanvas);

      this.scanStatus.set('done');
    } catch (err) {
      console.error('Perspective warp failed:', err);
      this.scanStatus.set('error');
    }
    this.cdr.markForCheck();
  }

  // ─── Step 3a: Deskew (projection-profile, ±5°) ────────────────────────────

  deskewCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;

    // Work on a 4× downsampled copy so angle search is fast (~620×877 pixels)
    const sw = Math.floor(w / 4);
    const sh = Math.floor(h / 4);
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    small.getContext('2d')!.drawImage(canvas, 0, 0, sw, sh);
    const sdata = small.getContext('2d')!.getImageData(0, 0, sw, sh).data;

    // Build binary array: 1 = black (ink), 0 = white
    const binary = new Uint8Array(sw * sh);
    for (let i = 0, j = 0; i < sdata.length; i += 4, j++) {
      binary[j] = sdata[i] < 128 ? 1 : 0;
    }

    // Projection-profile deskew: find the angle (-5°…+5°) whose horizontal
    // row-sum projection has the highest variance (text lines become sharp peaks).
    const cx = sw / 2;
    const cy = sh / 2;
    let bestAngle = 0;
    let bestVariance = -1;

    for (let deg = -5; deg <= 5; deg += 0.5) {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const proj = new Float32Array(sh);

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const sx = Math.round(cos * (x - cx) + sin * (y - cy) + cx);
          const sy = Math.round(-sin * (x - cx) + cos * (y - cy) + cy);
          if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
            proj[y] += binary[sy * sw + sx];
          }
        }
      }

      let mean = 0;
      for (let y = 0; y < sh; y++) mean += proj[y];
      mean /= sh;
      let variance = 0;
      for (let y = 0; y < sh; y++) variance += (proj[y] - mean) ** 2;

      if (variance > bestVariance) {
        bestVariance = variance;
        bestAngle = deg;
      }
    }

    if (Math.abs(bestAngle) < 0.25) return; // negligible tilt, skip

    // Rotate full-res canvas in-place by bestAngle
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d')!;
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, w, h);
    tctx.translate(w / 2, h / 2);
    tctx.rotate((bestAngle * Math.PI) / 180);
    tctx.drawImage(canvas, -w / 2, -h / 2);

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0);
  }

  // ─── Steps 3b–3d: Grayscale → sharpen → adaptive threshold → levels ───────
  //
  // applyFilter implements the full CamScanner-style image pipeline:
  //   1. Grayscale (perceptual luminance weights)
  //   2. Unsharp mask on grayscale — sharpens text before thresholding so
  //      letter edges produce cleaner black transitions
  //   3. Integral-image adaptive threshold — uses a 300px local window to
  //      estimate the background brightness at each pixel, then normalises
  //      the pixel against that estimate.  This removes shadows, uneven
  //      lighting, and camera vignetting in a single O(n) pass.
  //   4. Levels curve — clips normalised values > 225 to pure white (paper)
  //      and < 105 to pure black (ink), keeping genuine mid-tones.

  applyFilter(canvas: HTMLCanvasElement, filterType: string) {
    if (filterType !== 'bw') return;

    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    // Step 1: Grayscale
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // Step 2: Unsharp mask on grayscale (kernel [[0,-1,0],[-1,5,-1],[0,-1,0]])
    // Sharpening before thresholding tightens letter edges → cleaner B&W output.
    const sharp = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const j = y * width + x;
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          sharp[j] = gray[j];
          continue;
        }
        const v = 5 * gray[j] - gray[j - 1] - gray[j + 1] - gray[j - width] - gray[j + width];
        sharp[j] = Math.max(0, Math.min(255, v));
      }
    }

    // Step 3: Build integral image over sharpened grayscale for O(1) local sums.
    // Float64 avoids overflow (max ≈ 255 × 2480 × 3508 ≈ 2.2 billion).
    const integral = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        integral[idx] =
          sharp[idx] +
          (x > 0 ? integral[idx - 1] : 0) +
          (y > 0 ? integral[idx - width] : 0) -
          (x > 0 && y > 0 ? integral[idx - width - 1] : 0);
      }
    }

    // Step 4: Adaptive threshold + levels curve.
    // A 300px local window estimates background brightness; the pixel is
    // normalised against it to cancel shadows and uneven lighting.
    const halfBlock = 150;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - halfBlock);
        const y1 = Math.max(0, y - halfBlock);
        const x2 = Math.min(width - 1, x + halfBlock);
        const y2 = Math.min(height - 1, y + halfBlock);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[y2 * width + x2] -
          (x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0) -
          (y1 > 0 ? integral[(y1 - 1) * width + x2] : 0) +
          (x1 > 0 && y1 > 0 ? integral[(y1 - 1) * width + (x1 - 1)] : 0);
        const localMean = sum / count;

        const idx = y * width + x;
        const normalised =
          localMean > 0 ? Math.min(255, (sharp[idx] / localMean) * 255) : sharp[idx];

        // Levels curve:
        //   > 225 → pure white  (paper background)
        //   < 105 → pure black  (ink / text)
        //   105–225 → kept as grey (intentional shading on form boxes)
        let val: number;
        if (normalised > 225) {
          val = 255;
        } else if (normalised < 105) {
          val = 0;
        } else {
          val = Math.round(normalised);
        }

        const pidx = idx * 4;
        data[pidx] = data[pidx + 1] = data[pidx + 2] = val;
        data[pidx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // ─── Step 5: Generate PDF and save to Firebase ────────────────────────────

  async saveDocument() {
    if (!this.selectedFile || !this.resultContainer.nativeElement.querySelector('canvas')) return;

    this.isProcessing.set(true);
    this.cdr.markForCheck();

    const canvas = this.resultContainer.nativeElement.querySelector('canvas') as HTMLCanvasElement;

    try {
      const docRef = doc(this.documentsCol);
      const docId = docRef.id;

      const rawPath = `images-test/${docId}_raw`;
      const processedPath = `images-test/${docId}`;

      // Upload raw photo
      await uploadBytes(ref(this.storage, rawPath), this.selectedFile);

      // Convert canvas pixel dimensions (at 300 dpi) to millimetres so jsPDF
      // produces a correctly-sized page.  unit:'px' treats pixels as typographic
      // points (~96 dpi), which inflates the page to ~2.6× A4 and makes every
      // viewer show the document zoomed in on mobile.
      // 1 inch = 25.4 mm, canvas is rendered at 300 dpi → px ÷ 300 × 25.4 = mm
      const mmW = (canvas.width  / 300) * 25.4;
      const mmH = (canvas.height / 300) * 25.4;
      const orientation = mmW < mmH ? 'portrait' : 'landscape';

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation, unit: 'mm', format: [mmW, mmH] });
      pdf.addImage(imgData, 'PNG', 0, 0, mmW, mmH);
      const pdfBlob = pdf.output('blob');

      await uploadBytes(ref(this.storage, processedPath), pdfBlob, { contentType: 'application/pdf' });

      const baseName = this.docName.trim() || this.selectedFile!.name.replace(/\.[^.]+$/, '');
      const pdfFileName = baseName.replace(/\.pdf$/i, '') + '.pdf';
      const document: ProcessedDoc = {
        contentType: 'application/pdf',
        documentDate: null,
        fileName: pdfFileName,
        folderId: 'inbox',
        ocrText: null,
        comment: this.comment,
        status: Status.Processed,
        processedFilePath: processedPath,
        rawFilePath: rawPath,
        uploadedAt: serverTimestamp(),
        tag: this.category || 'scan',
        id: docId,
      };

      await setDoc(docRef, document);
      this.router.navigate(['/viewDocs']);
    } catch (err) {
      console.error('Error saving:', err);
      this.isProcessing.set(false);
      this.cdr.markForCheck();
    }
  }
}