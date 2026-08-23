# Backlog (post-launch ideas)

Rough priority. Each item gets its own implementation prompt when picked up.
Principles: minimal time in app, glanceable, no gamification, no animations
beyond existing.

1. ✅ Undo last completion (long-press sheet). Later: manual state setter
   (Fresh / Due soon / Overdue / pick a date).
2. ✅ Completion sound (soft chord) + mute toggle.
3. Travel / away mode — "away from/to" dates; elapsed time doesn't count for
   tasks flagged pausesWhenAway (use-driven: sheets, towels, shower,
   handles…). Needs per-task flag + schema bump. "Away" chip in banner.
4. Named rooms + room-type research — real editable names (prefill from
   type); research common room types (utility/laundry, guest, kids, study,
   garage, storage, WC, walk-in closet, dining, entrance, basement, attic,
   terrace/garden) with sensible defaults.
5. More appliances per room + their tasks — research common items (kitchen:
   dishwasher filter, hood filter, fridge coils, kettle descale, microwave,
   toaster, coffee machine; bath: extractor fan, toothbrush holder, bath mat,
   shower head descale; bedroom: pillows, duvet, under-bed; living: screens,
   speakers, shelves, radiator; general: smoke detector, door mats, light
   fixtures, bins deep-clean, air purifier/humidifier/vacuum filters) with
   suggested cycles.
6. Edit earlier rooms/tasks inside the wizard from the overview, before
   "Build my home".
7. ✅ Collapsible rooms in Rooms view.
8. Linked tasks — library field linkedTo (mop → vacuum); on completing one,
   one-tap "Also done: X?"; Focus mode plans pairs together.
9. **Sound polish: drain + chime** — split the completion sound into two
   parts synced to the existing completion animation: a short positive
   "draining" sound (descending sweep, e.g. sine 880→440 Hz over the drain
   duration, quiet ~0.12 gain, slightly filtered) while the drop bar drains,
   then the existing soft chord exactly when the tile blinks/resets. Drain
   duration should follow the animation's actual duration constant so they
   stay in sync. Keep the single mute toggle.
