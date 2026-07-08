# 2026-07-02 Self Audit

## Scope

Current local prototype at `http://127.0.0.1:5173/`.

## Findings

1. The six-size preview area was too small to judge production quality.
   - Fix: added one large active-size preview, then kept the six sizes as selectable thumbnails.

2. The AI candidate column had too much visual weight.
   - Fix: changed candidates from four large stacked cards to a calmer two-column set, so template preview becomes the main review surface.

3. The fixed bottom action bar covered preview thumbnails and created pressure.
   - Fix: changed it into a normal bottom action area that no longer overlays content.

4. Preview canvases could distort because max-height was constraining aspect ratio.
   - Fix: replaced height limiting with ratio-based max-width constraints.

5. Clicking a thumbnail could leave the large preview above the viewport.
   - Fix: selecting a size scrolls the active preview back into view.

6. The mobile order delayed visual confirmation.
   - Fix: on narrow screens, activity info is followed by multi-size preview, while AI prompt/candidates move later.

## Verification

- Desktop screenshot: `07-final-desktop.png`
- 398 selected screenshot: `08-final-398-selected.png`
- Mobile screenshot: `09-final-mobile.png`
- Build command passed: `npm run build`

## Template Checks

- `398 x 225`: active preview reports title `42px`, subtitle `24px`, button `120x42 / 24px`.
- `240 x 360`: title layer uses `text-align: center`, `left: 0%`, `width: 100%`.
- Active preview ratios match source dimensions for checked sizes.
