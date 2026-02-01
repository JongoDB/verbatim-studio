# Onboarding Tour Design

**Issue:** #77 - Redesign Dashboard 'Get Started' section with feature discovery experience
**Date:** 2026-02-01
**Status:** Approved

## Overview

Replace the minimal "Get Started" section with an interactive guided tour that walks new users through all app features. The tour highlights actual UI elements (sidebar navigation, chat assistant bubble) with tooltips, rather than showing static feature cards.

## User Experience Flow

1. **First visit:** Welcome modal appears asking if user wants a tour
2. **Tour accepted:** Sequential walkthrough highlighting each feature
3. **Tour skipped:** Dashboard shows "Take Tour" section for later
4. **Tour completed:** Celebration toast, dashboard shows subtle "Retake tour" link

## Tour Steps (9 total)

| Step | Target | Title | Description |
|------|--------|-------|-------------|
| 1 | Sidebar: Recordings | Recordings | Upload audio or video files for AI-powered transcription |
| 2 | Sidebar: Live | Live Transcription | Real-time transcription as you speak—perfect for meetings |
| 3 | Sidebar: Documents | Documents | Extract and search text from PDFs, images, and scanned files |
| 4 | Sidebar: Projects | Projects | Organize your transcripts and documents into folders |
| 5 | Sidebar: Chats | Chats | Have AI conversations about your transcripts |
| 6 | Sidebar: Search | Search | Find anything across all your content instantly |
| 7 | Sidebar: Browser | Browser | Browse and manage all your files in one place |
| 8 | Sidebar: Settings | Settings | Configure transcription, AI models, appearance, and more |
| 9 | Chat Assistant bubble | Assistant | Quick AI help—ask questions about anything, including how to use this app |

## Components

### OnboardingTour
Main tour controller component.
- Manages current step, visibility, and state
- Renders dimmed backdrop overlay (`rgba(0, 0, 0, 0.5)`, `z-index: 40`)
- Positions tooltips relative to target elements using `data-tour` attributes

### TourTooltip
The tooltip shown at each step.
- Title, description, step counter (e.g., "3 of 9")
- Skip and Next buttons (Finish on last step)
- Positioned dynamically:
  - Sidebar items: tooltip to the **right**
  - Chat Assistant bubble: tooltip **above and left**
- Design: `bg-card`, `border-border`, `rounded-lg`, `shadow-lg`, max-width ~280px
- Small arrow/caret pointing to target element
- Fade + slide transition between steps

### WelcomeModal
First-visit modal.
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    👋 Welcome to Verbatim Studio                │
│                                                                 │
│     Your AI-powered workspace for transcription, documents,     │
│                    and intelligent search.                      │
│                                                                 │
│     Would you like a quick tour of the features?                │
│                                                                 │
│         [Start Tour]              [Maybe Later]                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
- Appears ~500ms after Dashboard loads
- Clicking backdrop does nothing (must choose option)
- "Start Tour" = primary button, begins tour
- "Maybe Later" = ghost button, sets `verbatim-tour-skipped: true`

### TourSection
Dashboard section replacing current "Get Started".

**Before tour:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ✨ New to Verbatim Studio?                                     │
│                                                                 │
│  Take a quick guided tour to discover all the features         │
│                                                                 │
│  [Start Tour]                                        [Skip →]   │
└─────────────────────────────────────────────────────────────────┘
```
- Dashed border style
- Primary button for "Start Tour"

**After tour (completed or skipped):**
```
[🔄 Retake the tour]
```
- Subtle text link, no border

## Visual Design

### Highlighted Element
- CSS `box-shadow` with pulsing animation
- Primary blue color (`hsl(var(--primary))`)
- `z-index: 50` to appear above backdrop

```css
@keyframes tour-pulse {
  0%, 100% { box-shadow: 0 0 0 4px hsl(var(--primary) / 0.3); }
  50% { box-shadow: 0 0 0 8px hsl(var(--primary) / 0.5); }
}
```

### Backdrop
- Fixed overlay, entire viewport
- `background: rgba(0, 0, 0, 0.5)`
- `z-index: 40`
- `pointer-events: none` except on highlighted element

### Transitions
- Tooltip fades and slides in on step change
- Backdrop fades in on tour start, out on end

## State Management

### localStorage Keys
- `verbatim-tour-completed`: boolean - user finished all 9 steps
- `verbatim-tour-skipped`: boolean - user clicked Skip or Maybe Later

### Tour State (in App.tsx or context)
```typescript
interface TourState {
  isActive: boolean;
  currentStep: number;
  showWelcomeModal: boolean;
}
```

### Visibility Logic
- Welcome modal: show if neither localStorage key exists
- Dashboard full section: tour not completed AND not skipped
- Dashboard "Retake" link: tour completed OR skipped

## Tour Completion

**On "Finish" click:**
1. Backdrop fades out
2. Celebration toast appears:
   ```
   🎉 You're all set!
   Start exploring or ask the Assistant if you need help.
   ```
   Auto-dismisses after 4 seconds
3. Set `verbatim-tour-completed: true`
4. Remove `verbatim-tour-skipped` if exists

**On "Skip" click:**
1. Tour ends immediately
2. No celebration toast
3. Set `verbatim-tour-skipped: true`

## File Structure

### New Files
```
packages/frontend/src/components/onboarding/
├── OnboardingTour.tsx      # Main tour controller + backdrop
├── TourTooltip.tsx         # Positioned tooltip component
├── WelcomeModal.tsx        # First-visit modal
├── TourSection.tsx         # Dashboard section component
└── tourSteps.ts            # Tour step definitions
```

### Files to Modify
- `App.tsx` - Add tour state, render OnboardingTour and WelcomeModal
- `Dashboard.tsx` - Replace "Get Started" with TourSection
- `Sidebar.tsx` - Add `data-tour="..."` attributes to nav items
- Chat Assistant bubble - Add `data-tour="assistant"` attribute

## Accessibility

- Keyboard navigation: Tab through Skip/Next buttons
- Focus management: Focus trapped in tooltip during tour
- ARIA: `role="dialog"` on tooltip, `aria-describedby` for descriptions
- Escape key: Triggers Skip behavior

## Responsive Behavior

- Tour works on all screen sizes
- Tooltip positioning adjusts to stay within viewport
- On mobile with collapsed sidebar, tour may need to expand sidebar first (or skip sidebar items)
