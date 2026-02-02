# Mobile UI/UX Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix responsive design issues and touch targets for mobile devices to ensure usability on phones and tablets.

**Architecture:** Add responsive breakpoints to fixed-position components, increase touch target sizes to minimum 44x44px, and add text overflow handling. Changes are CSS/Tailwind-focused with no backend modifications.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Task 1: Add Touch Target Utility to Tailwind Config

**Files:**
- Modify: `packages/frontend/tailwind.config.ts:47-52`

**Step 1: Add min-size utility for touch targets**

Add a custom utility to the tailwind config for consistent touch target sizing:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      minWidth: {
        'touch': '44px',
      },
      minHeight: {
        'touch': '44px',
      },
    },
  },
  plugins: [],
};

export default config;
```

**Step 2: Verify build succeeds**

Run: `cd packages/frontend && npm run build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add packages/frontend/tailwind.config.ts
git commit -m "feat: add touch target size utilities to tailwind config"
```

---

## Task 2: Make ChatPanel Responsive

**Files:**
- Modify: `packages/frontend/src/components/ai/ChatPanel.tsx:164`

**Step 1: Update ChatPanel container classes**

Change the fixed positioning to be responsive, making it full-screen on mobile and positioned on desktop:

```tsx
// Line 164 - Replace the className prop
<div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-200 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[400px] sm:h-[500px] sm:rounded-xl sm:shadow-2xl sm:border sm:border-gray-200 sm:dark:border-gray-700">
```

This change:
- Mobile (`<sm`): Full screen with `inset-0`
- Desktop (`sm+`): Original fixed positioning with `bottom-24 right-6 w-[400px] h-[500px]`

**Step 2: Verify visually**

Open the app on mobile viewport (320px width) and verify:
- Chat panel fills entire screen
- No overflow or clipping

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatPanel.tsx
git commit -m "fix: make ChatPanel responsive for mobile devices"
```

---

## Task 3: Fix ChatInput Touch Targets

**Files:**
- Modify: `packages/frontend/src/components/ai/ChatInput.tsx:39-75`

**Step 1: Update attach button with touch target**

Change line 39-54 to use min-w-touch min-h-touch:

```tsx
<button
  type="button"
  onClick={onAttachClick}
  className="relative shrink-0 min-w-touch min-h-touch flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
  title="Attach transcripts"
  aria-label="Attach transcripts"
>
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
  {attachedCount > 0 && (
    <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
      {attachedCount}
    </span>
  )}
</button>
```

**Step 2: Update send button with touch target**

Change line 66-75 to use min-w-touch min-h-touch:

```tsx
<button
  type="submit"
  disabled={disabled || !input.trim()}
  className="shrink-0 min-w-touch min-h-touch flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  aria-label="Send message"
>
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
</button>
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatInput.tsx
git commit -m "fix: increase ChatInput button touch targets to 44x44px"
```

---

## Task 4: Fix ChatMessages Text Overflow

**Files:**
- Modify: `packages/frontend/src/components/ai/ChatMessages.tsx:49,61`

**Step 1: Add break-words to message bubbles**

Update line 49 to add `break-words`:

```tsx
<div
  className={`max-w-[80%] rounded-lg px-4 py-2 break-words ${
    msg.role === 'user'
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
  }`}
>
```

**Step 2: Add break-words to streaming message bubble**

Update line 61:

```tsx
<div className="max-w-[80%] rounded-lg px-4 py-2 break-words bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100" aria-live="polite">
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatMessages.tsx
git commit -m "fix: add break-words to ChatMessages to prevent text overflow"
```

---

## Task 5: Fix ChatHeader Touch Targets

**Files:**
- Modify: `packages/frontend/src/components/ai/ChatHeader.tsx:36-84`

**Step 1: Update all header buttons with touch targets**

Replace each button's `p-1.5` with `min-w-touch min-h-touch flex items-center justify-center`:

History button (line 36-46):
```tsx
<button
  onClick={onViewHistory}
  className="min-w-touch min-h-touch flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
  aria-label="View saved chats"
  title="Saved Chats"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
</button>
```

Save button (line 48-60):
```tsx
<button
  onClick={onSave}
  disabled={!hasMessages}
  className="min-w-touch min-h-touch flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
  aria-label="Save conversation"
  title="Save"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
  </svg>
</button>
```

Clear button (line 62-74):
```tsx
<button
  onClick={onClear}
  disabled={!hasMessages && attached.length === 0}
  className="min-w-touch min-h-touch flex items-center justify-center rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
  aria-label="Clear conversation"
  title="Clear"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
</button>
```

Close button (line 76-84):
```tsx
<button
  onClick={onClose}
  className="min-w-touch min-h-touch flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
  aria-label="Close chat"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
</button>
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/ai/ChatHeader.tsx
git commit -m "fix: increase ChatHeader button touch targets to 44x44px"
```

---

## Task 6: Fix TranscriptSearch Touch Targets

**Files:**
- Modify: `packages/frontend/src/components/transcript/TranscriptSearch.tsx:151-182`

**Step 1: Update navigation buttons with touch targets**

Previous button (line 151-160):
```tsx
<button
  onClick={handlePrev}
  disabled={matches.length === 0}
  className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  title="Previous match (Shift+Enter)"
>
  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
  </svg>
</button>
```

Next button (line 161-170):
```tsx
<button
  onClick={handleNext}
  disabled={matches.length === 0}
  className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  title="Next match (Enter)"
>
  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
</button>
```

Close button (line 174-182):
```tsx
<button
  onClick={onClose}
  className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted transition-colors"
  title="Close (Esc)"
>
  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
</button>
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/transcript/TranscriptSearch.tsx
git commit -m "fix: increase TranscriptSearch button touch targets to 44x44px"
```

---

## Task 7: Fix BulkHighlightToolbar Touch Targets and Positioning

**Files:**
- Modify: `packages/frontend/src/components/transcript/BulkHighlightToolbar.tsx:26,35-41`

**Step 1: Update toolbar container for safe area and mobile keyboard**

Update line 26 to add safe area padding:

```tsx
<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/80 shadow-xl backdrop-blur-sm safe-area-inset-bottom sm:bottom-6">
```

**Step 2: Update color picker buttons with touch targets**

Update lines 35-41 to use touch-friendly sizing:

```tsx
<div className="flex items-center gap-1.5">
  {COLORS.map(({ value, bg, label }) => (
    <button
      key={value}
      onClick={() => onHighlight(value)}
      className={`min-w-touch min-h-touch flex items-center justify-center rounded-full ${bg} transition-transform hover:scale-110 shadow-sm`}
      title={`Highlight ${label}`}
    >
      <span className="w-6 h-6 rounded-full" />
    </button>
  ))}
</div>
```

Actually, a simpler approach - just increase the button size directly:

```tsx
<div className="flex items-center gap-2">
  {COLORS.map(({ value, bg, label }) => (
    <button
      key={value}
      onClick={() => onHighlight(value)}
      className={`w-11 h-11 rounded-full ${bg} transition-transform hover:scale-110 shadow-sm`}
      title={`Highlight ${label}`}
    />
  ))}
</div>
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/transcript/BulkHighlightToolbar.tsx
git commit -m "fix: increase BulkHighlightToolbar touch targets to 44x44px"
```

---

## Task 8: Fix RecordingCard Button Touch Targets

**Files:**
- Modify: `packages/frontend/src/components/recordings/RecordingCard.tsx:223-270`

**Step 1: Update all action buttons with minimum touch targets**

Update the button classes to have minimum 44px height. Change `py-1.5` to `py-2.5` and add `min-h-touch`:

Transcribe button (line 223-228):
```tsx
<button
  onClick={onTranscribe}
  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2.5 min-h-touch text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
>
  Transcribe
</button>
```

Cancel button (line 230-236):
```tsx
<button
  onClick={onCancel}
  className="inline-flex items-center justify-center rounded-md border border-orange-500/50 px-3 py-2.5 min-h-touch text-sm font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
>
  Cancel
</button>
```

View Transcript button (line 238-244):
```tsx
<button
  onClick={onView}
  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2.5 min-h-touch text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
>
  View Transcript
</button>
```

Retry button (line 246-252):
```tsx
<button
  onClick={onRetry}
  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2.5 min-h-touch text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
>
  Retry
</button>
```

Edit button (line 254-263):
```tsx
<button
  onClick={onEdit}
  className="inline-flex items-center justify-center rounded-md border border-border px-3 py-2.5 min-h-touch text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
  title="Edit recording"
>
  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
</button>
```

Delete button (line 265-269):
```tsx
<button
  onClick={onDelete}
  className="inline-flex items-center justify-center rounded-md border border-destructive/50 px-3 py-2.5 min-h-touch text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
>
  Delete
</button>
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/recordings/RecordingCard.tsx
git commit -m "fix: increase RecordingCard button touch targets to 44px height"
```

---

## Task 9: Fix Sidebar Touch Targets

**Files:**
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx:123-131,183-208`

**Step 1: Update hamburger menu button**

Update lines 123-131 to have proper touch target:

```tsx
<button
  onClick={() => setMobileOpen(true)}
  className="fixed top-4 left-4 z-50 md:hidden min-w-touch min-h-touch flex items-center justify-center rounded-lg bg-card border border-border shadow-sm"
  aria-label="Open navigation"
>
  <svg className="w-5 h-5 text-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
</button>
```

**Step 2: Update collapse toggle button**

Update lines 183-198 to have proper touch target:

```tsx
<button
  onClick={() => onCollapsedChange(true)}
  className={`hidden ${collapsed ? '' : 'md:flex'} ml-auto min-w-touch min-h-touch items-center justify-center rounded-md hover:bg-muted transition-colors`}
  aria-label="Collapse sidebar"
>
  <svg
    className="w-4 h-4 text-muted-foreground"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
  </svg>
</button>
```

**Step 3: Update mobile close button**

Update lines 200-208:

```tsx
<button
  onClick={() => setMobileOpen(false)}
  className="md:hidden ml-auto min-w-touch min-h-touch flex items-center justify-center rounded-md hover:bg-muted transition-colors"
  aria-label="Close navigation"
>
  <svg className="w-4 h-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
</button>
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/layout/Sidebar.tsx
git commit -m "fix: increase Sidebar button touch targets to 44x44px"
```

---

## Task 10: Final Verification

**Step 1: Build the project**

Run: `cd packages/frontend && npm run build`
Expected: Build completes without errors

**Step 2: Run type check**

Run: `cd packages/frontend && npm run typecheck`
Expected: No type errors

**Step 3: Visual testing checklist**

Test in browser dev tools at these viewports:
- [ ] iPhone SE (320px width)
- [ ] iPhone 14 Pro (393px width)
- [ ] Samsung Galaxy S21 (360px width)
- [ ] iPad Mini portrait (744px width)

Verify for each:
- [ ] ChatPanel fills screen on mobile, positioned on desktop
- [ ] All buttons have adequate touch targets (44x44px minimum)
- [ ] Long text in chat messages wraps properly
- [ ] No horizontal overflow on any component
- [ ] BulkHighlightToolbar visible above mobile keyboard area

**Step 4: Create final commit for any remaining fixes**

If any issues found during testing, fix and commit appropriately.

---

## Summary

This plan addresses all issues from GitHub issue #78:

1. **ChatPanel** - Made fully responsive (full-screen mobile, positioned desktop)
2. **Touch targets** - Added 44x44px minimum to all interactive elements via `min-w-touch min-h-touch` utilities
3. **Text overflow** - Added `break-words` to chat message bubbles
4. **Components fixed:**
   - ChatPanel.tsx
   - ChatInput.tsx
   - ChatMessages.tsx
   - ChatHeader.tsx
   - TranscriptSearch.tsx
   - BulkHighlightToolbar.tsx
   - RecordingCard.tsx
   - Sidebar.tsx
   - tailwind.config.ts
