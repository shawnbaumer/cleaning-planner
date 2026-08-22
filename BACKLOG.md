# Backlog

9. **Sound polish: drain + chime** — split the completion sound into two
   parts synced to the existing completion animation: a short positive
   "draining" sound (descending sweep, e.g. sine 880→440 Hz over the drain
   duration, quiet ~0.12 gain, slightly filtered) while the drop bar drains,
   then the existing soft chord exactly when the tile blinks/resets. Drain
   duration should follow the animation's actual duration constant so they
   stay in sync. Keep the single mute toggle.
