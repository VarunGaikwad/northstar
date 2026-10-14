# Momentum-Style UI Redesign for Northstar Frontend

## Goal
Transform the current glassmorphism dashboard into a Momentum Chrome Extension-style new tab page: full-screen Unsplash background, large centered clock, greeting, daily focus prompt, and a minimal bottom bar that reveals widgets on interaction.

## Design Decisions (Resolved)
- **Background**: Unsplash API (live fetch, random landscape/nature photo on each load)
- **Default view**: Minimal — clock, greeting, focus, search bar only
- **Focus feature**: Add "What is your main focus for today?" persisted in localStorage
- **Widget access**: Bottom bar icons with slide-up panels for Weather, LRT, Quick Access
- **Quick Access**: Icon strip of active folder links in bottom bar; full folder management in slide-up panel

## Architecture

### Layout (Top to Bottom)
```
┌──────────────────────────────────────────────┐
│  [Search bar — top center, semi-transparent] │
│                                              │
│                                              │
│           14:32                              │
│     Good Morning, User                       │
│  "What is your main focus for today?"        │
│     [Focus input / display]                  │
│                                              │
│                                              │
│ [🔖 Links] [☀ Weather] [🚊 LRT] [⚙ Settings]│
└──────────────────────────────────────────────┘
```

### New Components
1. `BackgroundImage` — Fetches and displays full-screen Unsplash photo with crossfade
2. `FocusPrompt` — "What is your main focus for today?" input, shows saved focus when set
3. `BottomBar` — Icon strip along bottom edge with hover/click slide-up panels
4. `SlideUpPanel` — Reusable animated panel that slides up from bottom bar icons

### Modified Components
- `App.tsx` — Complete layout restructure (remove 3-column grid, add centered layout)
- `Header.tsx` → `Clock.tsx` — Massive centered clock + greeting (no flex header layout)
- `SearchBar.tsx` — Restyled to be more transparent/minimal, positioned at top
- `QuickAccess.tsx` — Split into `BottomBar` icon strip + `SlideUpPanel` content
- `WeatherWidget.tsx` — Content unchanged, wrapped in slide-up panel
- `LrtWidget.tsx` — Content unchanged, wrapped in slide-up panel
- `index.css` — Remove blob/dot animations, add slide-up panel animations, crossfade for backgrounds

### Unchanged Components (restyled only)
- `Modal.tsx`, `ConfirmDialog.tsx`, `FolderFormModal.tsx`, `LinkFormModal.tsx` — Keep glass style, minor tweaks for readability over photo backgrounds
- `LinkCard.tsx` — Minor restyle for panel context
- `FolderChips.tsx` — Minor restyle for panel context

## Implementation Tasks (Ordered)

### 1. Unsplash Background Image
- Create `src/hooks/useUnsplash.ts` — fetches a random photo from Unsplash API (`https://api.unsplash.com/photos/random?query=nature,landscape&orientation=landscape`), caches URL in localStorage with a daily rotation key
- Create `src/components/BackgroundImage.tsx` — full-screen `<img>` with CSS crossfade transition, dark overlay gradient for text readability
- Remove blob/dot CSS from `index.css`
- Update `body` background to solid dark fallback color
- **Note**: Unsplash API requires an access key. Use a demo/public key or prompt user to add one via `.env` (`VITE_UNSPLASH_ACCESS_KEY`). For initial development, use a hardcoded fallback image URL.

### 2. Clock & Greeting (Centered Hero)
- Rename `Header.tsx` → `Clock.tsx` (or create new component)
- Display time in extra-large font (text-7xl to text-9xl), thin/light weight, centered
- Greeting below clock in medium font
- Date below greeting in small font
- All text white with subtle text-shadow for readability over photo
- Remove the flex header layout (no left/right split)

### 3. Focus Feature
- Create `src/components/FocusPrompt.tsx`
- State: `focus` string persisted in localStorage (`dashboard.focus`)
- Two modes:
  - **Empty**: Show input "What is your main focus for today?" with underline-style input
  - **Set**: Show the focus text prominently (large, centered), click to edit
- Reset daily: store timestamp alongside focus, clear if date has changed

### 4. Search Bar Restyle
- Move to top of viewport (fixed or absolute top-center)
- More transparent background (`bg-white/[0.05]` or less)
- Thinner border, smaller height
- Keep engine selector and search functionality
- Appear on focus/hover with subtle expand animation

### 5. Bottom Bar & Slide-Up Panels
- Create `src/components/BottomBar.tsx`
  - Fixed to bottom edge, centered row of icon buttons
  - Icons: Bookmarks (Quick Access), Weather, LRT
  - Each icon toggles its associated slide-up panel
  - Only one panel open at a time
- Create `src/components/SlideUpPanel.tsx`
  - Positioned above the bottom bar
  - Animated slide-up with backdrop blur glass panel
  - Contains the widget content (Weather, LRT, or Quick Access)
  - Close on click outside or Escape key
  - Max height ~60vh, scrollable internally
- Restyle `QuickAccess.tsx` content for panel context (remove outer card styling)
- Restyle `WeatherWidget.tsx` for panel context (remove outer card styling)
- Restyle `LrtWidget.tsx` for panel context (remove outer card styling)

### 6. Quick Access Icon Strip
- In the bottom bar, show small favicon/initial icons for active folder's links (max ~8 visible)
- Clicking a link opens it in new tab
- "Manage" button or folder chips accessible in the slide-up panel
- Folder switcher (chips) moved into the slide-up panel

### 7. App.tsx Layout Restructure
- Replace 3-column grid with full-viewport centered flex column
- Layer: BackgroundImage → dark overlay → content (clock, greeting, focus, search)
- Bottom bar fixed at bottom
- Modals remain as-is (they overlay everything)

### 8. CSS Updates (`index.css`)
- Remove `.blob`, `.bg-dots`, `@keyframes blob-float`
- Add `@keyframes slide-up` for panel animation
- Add `@keyframes fade-in` for background crossfade
- Add `@keyframes focus-appear` for focus text transitions
- Update body background to solid dark color as fallback

### 9. Typography & Polish
- Add a lighter font weight option (e.g., Inter 300) for the large clock
- Ensure all text has appropriate text-shadow for photo background readability
- Add subtle backdrop-blur to bottom bar
- Photo credit attribution in bottom-right corner (Unsplash photographer name)

### 10. Types Update
- Add `focus?: string` and `focusDate?: string` to `DashboardState` (or use separate localStorage key)

## Files Affected
| File | Action |
|------|--------|
| `src/App.tsx` | Major rewrite — new layout |
| `src/index.css` | Remove blobs, add panel animations |
| `src/components/Header.tsx` | Replace with Clock.tsx or rewrite |
| `src/components/SearchBar.tsx` | Restyle for minimal top position |
| `src/components/QuickAccess.tsx` | Restyle for panel context |
| `src/components/WeatherWidget.tsx` | Remove outer card, restyle for panel |
| `src/components/LrtWidget.tsx` | Remove outer card, restyle for panel |
| `src/components/LinkCard.tsx` | Minor restyle |
| `src/components/FolderChips.tsx` | Minor restyle |
| `src/components/BackgroundImage.tsx` | **New** |
| `src/components/FocusPrompt.tsx` | **New** |
| `src/components/BottomBar.tsx` | **New** |
| `src/components/SlideUpPanel.tsx` | **New** |
| `src/hooks/useUnsplash.ts` | **New** |
| `src/types.ts` | Add focus fields |
| `index.html` | Possibly add lighter Inter weight |

## Risks & Mitigations
- **Unsplash API rate limits**: Cache photo URL in localStorage, rotate daily (not per-request). Fallback to a bundled gradient or static image if API fails.
- **Text readability over photos**: Dark gradient overlay (bottom-to-top, 60-80% opacity) ensures white text is always readable regardless of photo.
- **Mobile responsiveness**: Bottom bar icons should wrap or scroll horizontally on small screens. Clock font should scale down with `text-5xl md:text-8xl`.
- **No API key configured**: Show a beautiful CSS gradient background as fallback when Unsplash key is missing.

## Validation
1. `npm run dev` — verify visual layout matches Momentum aesthetic
2. `npm run build` — no TypeScript or build errors
3. `npm run lint` — no lint errors
4. Test focus feature: set focus, refresh page (should persist), wait for next day (should reset)
5. Test bottom bar: open each panel, verify close on outside click and Escape
6. Test search: verify engine selection and search submission
7. Test Quick Access: add/edit/delete folders and links in slide-up panel
8. Test background: verify Unsplash photo loads, fallback works without API key
9. Test mobile: verify responsive layout at 375px width
