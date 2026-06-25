# Story 12 — Manual reorder of TT start list

## Overview
After the start order is generated, the organizer can drag individual riders to different positions within their category. Riders cannot be moved across categories.

## User story
As a race organizer, I need to manually adjust the start order within each category after it has been auto-generated so that I can accommodate last-minute changes without regenerating the whole list.

## Behaviour

### Drag-to-reorder
- Each rider row in the start order table is draggable within its category block
- Dragging a rider to a new position within the same category shifts other riders up or down accordingly
- Dragging a rider to a different category block is not allowed — the drag is rejected and the rider snaps back with a brief inline message: "Riders can only be reordered within their own category."

### Start time recalculation
- After any manual reorder, all start times within the affected category are recalculated immediately based on the new positions and the existing interval configuration
- The gap between categories is preserved; reordering within one category does not shift the start times of other categories

### Undo
- A single-level **Undo** button is available while on the page to reverse the last drag action
- Navigating away discards undo history

### Lock on stage start
- Once the live TT session is started (Story 17), the start order becomes read-only
- The drag handles are hidden and a notice is shown: "The stage has started — the start order is now locked."

## Acceptance criteria
- [ ] Riders can be dragged to new positions within their category
- [ ] Dragging across category blocks is rejected with an inline message
- [ ] Start times recalculate immediately after a drag
- [ ] Gap between categories is unaffected by within-category reordering
- [ ] Undo reverses the last drag action
- [ ] Start order is locked (read-only) once the live session has started

## Dependencies
- Story 11 (start order must be generated before it can be reordered)
