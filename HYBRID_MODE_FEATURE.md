# Hybrid Mode Feature: Cut vs Keep Segments

## ✅ Implementation Complete

Successfully implemented hybrid mode support allowing users to choose between:
- **Cut Mode**: Mark parts to remove (original behavior)
- **Keep Mode**: Mark parts to keep (new behavior)

---

## 🎯 What Was Added

### 1. **New Types**
- `TimelineSegment` - Represents a segment to keep (inverse of cut)

### 2. **TimelineService Enhancements**
- `mode` signal - Tracks current mode ('cut' | 'keep')
- `segments` signal - Array of segments to keep
- `segmentSelection` signal - Selection for adding segments
- `effectiveCuts` computed - Automatically converts segments to cuts for rendering
- `setMode()` - Switch between cut and keep modes
- `addSegment()` - Add a segment to keep
- `deleteSegment()` - Remove a segment
- `clearAllSegments()` - Clear all segments

### 3. **Timeline Utilities**
- `segmentsToCuts()` - Convert keep segments to remove cuts
- `cutsToSegments()` - Convert remove cuts to keep segments
- `isTimeInSegment()` - Check if time is in a kept segment
- `isRangeInSegments()` - Check if range is within kept segments
- `validateOverlayTimesForSegments()` - Validate overlays against segments

### 4. **OverlayService Updates**
- All overlay methods now accept `mode`, `cuts`, and `segments`
- Validation automatically switches based on mode:
  - **Cut Mode**: Overlays cannot be in cuts
  - **Keep Mode**: Overlays must be within segments

### 5. **Component Updates**
- Exposed new signals: `segments`, `segmentSelection`, `timelineMode`, `hasSegments`
- `toggleTimelineMode()` - Switch between modes
- `addCut()` - Works with both modes (adds cut or segment)
- `addSegment()` - Explicit segment addition
- `removeSegment()` - Remove a segment
- `focusSegment()` - Focus on a segment
- Render uses `effectiveCuts` (auto-converts segments if needed)

---

## 🔄 How It Works

### Cut Mode (Default)
```
Timeline: [0s ─────── 10s ─CUT─ 20s ─────── 30s]
User marks: [10s-20s] to remove
Result: [0s-10s, 20s-30s] kept
```

### Keep Mode
```
Timeline: [0s ─────── 10s ─────── 20s ─────── 30s]
User marks: [0s-10s, 20s-30s] to keep
Result: [0s-10s, 20s-30s] kept (same result!)
```

### Automatic Conversion
When rendering in Keep Mode:
1. Frontend converts segments to cuts
2. Sends cuts to backend (no API changes needed)
3. Backend processes normally

---

## 📊 Code Changes Summary

### Files Modified
1. **`video-editor.types.ts`**
   - Added `TimelineSegment` interface

2. **`utils/timeline.utils.ts`**
   - Added conversion functions
   - Added segment validation functions

3. **`services/timeline.service.ts`**
   - Added mode management
   - Added segment management
   - Added effectiveCuts computed

4. **`services/overlay.service.ts`**
   - Updated all add methods to accept mode
   - Dual validation logic

5. **`video-editor.component.ts`**
   - Exposed new signals
   - Added mode toggle
   - Updated overlay methods
   - Updated render to use effectiveCuts

---

## 🎨 UI Integration Needed

The backend logic is complete, but the UI needs to be updated to:

1. **Add Mode Toggle Button**
   ```html
   <button (click)="toggleTimelineMode()">
     Mode: {{ timelineMode() === 'cut' ? 'Cut' : 'Keep' }}
   </button>
   ```

2. **Update Labels Based on Mode**
   ```html
   @if (timelineMode() === 'cut') {
     <h3>Cuts (Remove)</h3>
     @for (cut of cuts(); track cut.id) { ... }
   } @else {
     <h3>Segments (Keep)</h3>
     @for (segment of segments(); track segment.id) { ... }
   }
   ```

3. **Update Selection Display**
   ```html
   Selection: {{ 
     timelineMode() === 'cut' 
       ? formatTime(cutSelection().start) + ' - ' + formatTime(cutSelection().end)
       : formatTime(segmentSelection().start) + ' - ' + formatTime(segmentSelection().end)
   }}
   ```

4. **Visual Distinction**
   - Cuts: Red/grayed out regions
   - Segments: Green/highlighted regions

---

## 🧪 Testing Checklist

### Cut Mode (Existing)
- [x] Add cuts
- [x] Remove cuts
- [x] Validate cut overlaps
- [x] Overlay validation against cuts
- [x] Render with cuts

### Keep Mode (New)
- [ ] Add segments
- [ ] Remove segments
- [ ] Validate segment overlaps
- [ ] Overlay validation against segments
- [ ] Render with segments (auto-converts to cuts)

### Mode Switching
- [ ] Toggle between modes
- [ ] Verify cuts cleared when switching to keep mode
- [ ] Verify segments cleared when switching to cut mode
- [ ] Verify overlays still work after mode switch

### Integration
- [ ] Full workflow: Keep mode → Add segments → Add overlays → Render
- [ ] Verify rendered video only contains marked segments
- [ ] Verify overlay times adjusted correctly

---

## 💡 Usage Examples

### Example 1: Keep Only Highlights
```
Video: 60 seconds
Keep Mode: ON
Segments:
  - [0s-5s] - Intro
  - [20s-25s] - Highlight 1
  - [45s-50s] - Highlight 2
Result: Only 15 seconds kept
```

### Example 2: Remove Unwanted Parts
```
Video: 60 seconds
Cut Mode: ON
Cuts:
  - [5s-20s] - Remove boring part
  - [25s-45s] - Remove another boring part
Result: Same 15 seconds kept (different approach)
```

---

## 🔧 API Compatibility

### ✅ No Backend Changes Required
- Frontend converts segments to cuts before sending
- Backend receives standard `cuts` array
- No API versioning needed
- Fully backward compatible

### Conversion Logic
```typescript
// Keep Mode: User marks [0-5s, 10-20s, 25-30s]
segments = [
  { start: 0, end: 5 },
  { start: 10, end: 20 },
  { start: 25, end: 30 }
]

// Auto-converted to cuts for API
cuts = [
  { start: 5, end: 10 },   // Gap between segments
  { start: 20, end: 25 }    // Gap between segments
]
```

---

## 📝 Next Steps

1. **UI Implementation** (Required)
   - Add mode toggle button
   - Update labels and displays
   - Add visual distinction for segments vs cuts

2. **Testing** (Required)
   - Test keep mode workflow
   - Test mode switching
   - Test overlay validation in keep mode

3. **Documentation** (Optional)
   - User guide for both modes
   - When to use which mode
   - Examples and use cases

---

## ✅ Status

**Backend Logic**: ✅ Complete  
**Service Integration**: ✅ Complete  
**Type Safety**: ✅ Complete  
**Linting**: ✅ Passing  
**Build**: ✅ Passing  
**UI Integration**: ⏳ Pending (needs template updates)

---

## 🎊 Summary

The hybrid mode feature is **fully implemented** at the service and component level. Users can now choose between:
- **Cut Mode**: Mark what to remove (original)
- **Keep Mode**: Mark what to keep (new)

The system automatically converts segments to cuts for rendering, so no backend changes are needed. The UI just needs to be updated to expose the toggle and show the appropriate labels/visuals.

**Ready for UI integration!** 🚀

