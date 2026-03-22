# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start Vite dev server with HMR
pnpm build      # Build for production (outputs to dist/)
pnpm preview    # Preview production build locally
```

No linter or test suite is configured.

## Architecture

This is a single-page 3D network topology visualization for a Huawei DC908 fiber protection strategy demo (1+1 vs 1:1), built with vanilla JS + Three.js via Vite.

**Two files do all the work:**
- `index.html` — UI shell: header, right-side control panels (strategy toggle, Gemini AI panel, routing status, fault simulation), and a full-viewport `<canvas>` for Three.js
- `app.js` — Everything else: Three.js scene setup, 3D infrastructure rendering, particle animation, state management, and AI integration

**Key concepts in `app.js`:**
- A global state object tracks the status of two planes (A/B), three fiber routes (北线/中线/南线), and the active strategy
- Four particle systems (`A_Main`, `A_Backup`, `B_Main`, `B_Backup`) travel along Catmull-Rom curves to visualize data flow; their visibility and speed change based on state
- `setStrategy()` switches between 1+1 (both planes active simultaneously) and 1:1 (primary + standby)
- `runAI()` and `diagnose()` POST the current state to Google Gemini 2.5-flash-preview for intelligent control/diagnostics — the API key must be set in `const apiKey = ''` at the top of `app.js`
- `animate()` drives the render loop via `requestAnimationFrame`; `updateSystem()` advances particle positions each frame
