# Cut Validation Feature

## Overview

Added validation to prevent users from placing overlays (text, image, shape) inside cut regions. Cuts represent segments that will be removed from the final video, so overlays placed in these regions would not appear in the rendered output.

## Features Implemented

### 1. **Cut Overlap Validation** ✅
When users try to add an overlay, the system now checks if the overlay's time range overlaps with any cut segments.

```typescript
// Validates overlay times against cuts
const validation = validateOverlayTimes(start, end, cuts);
if (!validation.isValid) {
  this.errorMessage.set(validation.error);
  return;
}
```

### 2. **Clear Error Messages** ✅
Users receive helpful feedback when attempting to place overlays in invalid locations:

> "Overlay cannot be placed in a cut region. Cuts will be removed from the final video."

### 3. **Timeline Utilities** ✅
Created comprehensive utilities in `src/app/video-editor/utils/timeline.utils.ts`:

```typescript
// Check if a time is within a cut
isTimeInCut(time, cuts) => boolean

// Check if a time range overlaps with cuts
isRangeInCut(start, end, cuts) => boolean

// Validate overlay placement
validateOverlayTimes(start, end, cuts) => { isValid, error? }

// Calculate adjusted time after cuts are removed
calculateAdjustedTime(originalTime, cuts) => adjustedTime

// Find nearest valid time outside cuts
findNearestValidTime(time, cuts) => validTime

// Get total duration removed by cuts
getTotalCutDuration(cuts) => duration
```

## How It Works

### Before (Without Validation)
```
Timeline: [0s -------- 10s -------- 20s -------- 30s]
Cuts:                  [10s - 15s] (removed)
Overlay:                    [12s - 14s] ❌ Would be invisible!
```

### After (With Validation)
```
Timeline: [0s -------- 10s -------- 20s -------- 30s]
Cuts:                  [10s - 15s] (removed)
Overlay:                    [12s - 14s] ❌ BLOCKED with error message
Overlay:     [5s - 8s]  ✅ Allowed (before cut)
Overlay:                              [16s - 19s] ✅ Allowed (after cut)
```

## Time Calculation (Future Enhancement)

The utilities also support calculating adjusted times for the final rendered video:

```typescript
// Example: Timeline with a cut
Original timeline: [0s -------- 10s -CUT- 20s -------- 30s]
                                [10s - 15s removed]

// Overlay at 25s in original timeline
Original time: 25s
Adjusted time: 20s (because 5s were removed before it)
```

This will be useful for:
- Showing users the "real" time in the final video
- Syncing overlays with the rendered output
- Timeline visualization improvements

## Implementation Details

### Modified Files
1. **`src/app/video-editor/utils/timeline.utils.ts`** (NEW)
   - Comprehensive timeline calculation utilities
   - Cut validation logic
   - Time adjustment calculations

2. **`src/app/video-editor/video-editor.component.ts`**
   - Updated `addTextOverlay()` with validation
   - Updated `addImageOverlay()` with validation
   - Updated `addShapeOverlay()` with validation
   - Imports timeline utilities

### Code Quality
- ✅ All functions have TypeScript type annotations
- ✅ Comprehensive JSDoc comments
- ✅ Pure functions (no side effects)
- ✅ Unit testable
- ✅ ESLint compliant
- ✅ Builds successfully

## User Experience

### When Adding Overlays
1. User enters overlay start/end times
2. System validates times against existing cuts
3. If overlap detected:
   - ❌ Overlay is NOT created
   - 🔴 Error message displayed
   - 💡 User can adjust times and retry
4. If no overlap:
   - ✅ Overlay created successfully
   - 🎨 Appears on canvas and timeline

### Error Message Example
```
❌ Overlay cannot be placed in a cut region. 
   Cuts will be removed from the final video.
```

## Testing Checklist

### Manual Testing
- [ ] Add a cut (e.g., 5s-10s)
- [ ] Try to add text overlay at 6s-8s → Should be blocked ✅
- [ ] Try to add image overlay at 3s-12s → Should be blocked ✅
- [ ] Try to add shape overlay at 2s-4s → Should succeed ✅
- [ ] Try to add shape overlay at 11s-13s → Should succeed ✅
- [ ] Add multiple cuts and verify overlays can't be placed in any of them
- [ ] Verify error message displays correctly

### Edge Cases
- [ ] Overlay exactly at cut boundary (start = cut.start)
- [ ] Overlay ending at cut boundary (end = cut.end)
- [ ] Very short overlay (0.1s) in tiny gap between cuts
- [ ] Multiple overlapping cuts
- [ ] Overlay spanning multiple cuts

## Future Enhancements

### 1. Visual Timeline Indicators
Show cut regions visually on the timeline:
```html
<div class="timeline-cuts">
  @for (cut of cuts(); track cut.id) {
    <div class="cut-marker" 
         [style.left.%]="(cut.start / duration()) * 100"
         [style.width.%]="((cut.end - cut.start) / duration()) * 100">
    </div>
  }
</div>
```

### 2. Auto-Adjust Feature
Automatically move overlays when cuts change:
- If a cut is added that overlaps an overlay
- Move the overlay to the nearest valid position
- Or show a warning and ask user to manually adjust

### 3. Smart Time Input
In overlay forms, show both:
- **Original time**: Position in original timeline
- **Adjusted time**: Position in final rendered video

```html
<input [(ngModel)]="overlayStart">
<small>Final video time: {{ calculateAdjustedTime(overlayStart) }}s</small>
```

### 4. Timeline Visualization
Add visual markers showing:
- 🔴 Cut regions (grayed out or striped)
- 🟢 Valid overlay regions (normal)
- ⚠️ Warning when dragging overlay near cut

### 5. Batch Validation
When cuts change, re-validate ALL existing overlays:
```typescript
protected onCutsChanged(): void {
  const invalidOverlays = this.overlays().filter(overlay =>
    !validateOverlayTimes(overlay.start, overlay.end, this.cuts()).isValid
  );
  
  if (invalidOverlays.length > 0) {
    // Show warning and offer to remove or adjust them
  }
}
```

## API Impact

### Render Payload
No changes to the render API. The backend receives:
- Overlays with their original timeline positions
- Cuts to be removed
- Backend calculates final overlay positions during rendering

The frontend validation ensures overlays won't be placed in cut regions before sending to backend.

## Summary

✅ **Core Feature Complete**
- Overlay placement validation working
- Error messages displaying
- All builds and lints passing

🔮 **Future Enhancements Ready**
- Utility functions prepared for time adjustments
- Visual feedback can be easily added
- Smart features can build on existing foundation

📊 **Impact**
- Prevents user errors
- Clearer UX around cuts and overlays
- More predictable rendering results

