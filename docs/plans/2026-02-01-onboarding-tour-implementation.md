# Onboarding Tour Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive guided tour that walks new users through all 9 app features via highlighted UI elements with tooltips.

**Architecture:** React components with portal-based overlay, CSS animations for pulsing glow, localStorage for persistence. Tour state managed in App.tsx and passed down via props. No external dependencies.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS animations

---

## Task 1: Create Tour Step Definitions

**Files:**
- Create: `packages/frontend/src/components/onboarding/tourSteps.ts`

**Step 1: Create the tour steps configuration file**

```typescript
export interface TourStep {
  id: string;
  target: string; // data-tour attribute selector
  title: string;
  description: string;
  position: 'right' | 'left' | 'top' | 'bottom';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'recordings',
    target: '[data-tour="recordings"]',
    title: 'Recordings',
    description: 'Upload audio or video files for AI-powered transcription',
    position: 'right',
  },
  {
    id: 'live',
    target: '[data-tour="live"]',
    title: 'Live Transcription',
    description: 'Real-time transcription as you speak—perfect for meetings',
    position: 'right',
  },
  {
    id: 'documents',
    target: '[data-tour="documents"]',
    title: 'Documents',
    description: 'Extract and search text from PDFs, images, and scanned files',
    position: 'right',
  },
  {
    id: 'projects',
    target: '[data-tour="projects"]',
    title: 'Projects',
    description: 'Organize your transcripts and documents into folders',
    position: 'right',
  },
  {
    id: 'chats',
    target: '[data-tour="chats"]',
    title: 'Chats',
    description: 'Have AI conversations about your transcripts',
    position: 'right',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Search',
    description: 'Find anything across all your content instantly',
    position: 'right',
  },
  {
    id: 'browser',
    target: '[data-tour="browser"]',
    title: 'Files',
    description: 'Browse and manage all your files in one place',
    position: 'right',
  },
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Settings',
    description: 'Configure transcription, AI models, appearance, and more',
    position: 'right',
  },
  {
    id: 'assistant',
    target: '[data-tour="assistant"]',
    title: 'Assistant',
    description: 'Quick AI help—ask questions about anything, including how to use this app',
    position: 'top',
  },
];

export const TOUR_STORAGE_KEYS = {
  completed: 'verbatim-tour-completed',
  skipped: 'verbatim-tour-skipped',
} as const;
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/tourSteps.ts | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/tourSteps.ts
git commit -m "feat(onboarding): add tour step definitions"
```

---

## Task 2: Create TourTooltip Component

**Files:**
- Create: `packages/frontend/src/components/onboarding/TourTooltip.tsx`

**Step 1: Create the tooltip component**

```typescript
import { useEffect, useRef, useState } from 'react';
import type { TourStep } from './tourSteps';

interface TourTooltipProps {
  step: TourStep;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  targetRect: DOMRect | null;
}

export function TourTooltip({
  step,
  currentStep,
  totalSteps,
  onNext,
  onSkip,
  targetRect,
}: TourTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const isLastStep = currentStep === totalSteps - 1;

  useEffect(() => {
    if (!targetRect || !tooltipRef.current) return;

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 12;

    let top = 0;
    let left = 0;

    switch (step.position) {
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.right + padding;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.left - tooltipRect.width - padding;
        break;
      case 'top':
        top = targetRect.top - tooltipRect.height - padding;
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'bottom':
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        break;
    }

    // Keep tooltip within viewport
    const viewportPadding = 16;
    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipRect.height - viewportPadding));
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));

    setPosition({ top, left });
  }, [targetRect, step.position]);

  return (
    <div
      ref={tooltipRef}
      className="fixed z-[60] w-72 bg-card border border-border rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-labelledby="tour-title"
      aria-describedby="tour-description"
    >
      {/* Arrow - positioned based on step.position */}
      <div
        className={`absolute w-3 h-3 bg-card border-border rotate-45 ${
          step.position === 'right'
            ? '-left-1.5 top-1/2 -translate-y-1/2 border-l border-b'
            : step.position === 'left'
            ? '-right-1.5 top-1/2 -translate-y-1/2 border-r border-t'
            : step.position === 'top'
            ? '-bottom-1.5 left-1/2 -translate-x-1/2 border-r border-b'
            : '-top-1.5 left-1/2 -translate-x-1/2 border-l border-t'
        }`}
      />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <h3 id="tour-title" className="text-base font-semibold text-foreground">
            {step.title}
          </h3>
          <span className="text-xs text-muted-foreground">
            {currentStep + 1} of {totalSteps}
          </span>
        </div>

        {/* Description */}
        <p id="tour-description" className="text-sm text-muted-foreground mb-4">
          {step.description}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/TourTooltip.tsx | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/TourTooltip.tsx
git commit -m "feat(onboarding): add TourTooltip component"
```

---

## Task 3: Create OnboardingTour Component

**Files:**
- Create: `packages/frontend/src/components/onboarding/OnboardingTour.tsx`

**Step 1: Create the main tour controller component**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TourTooltip } from './TourTooltip';
import { TOUR_STEPS, TOUR_STORAGE_KEYS } from './tourSteps';

interface OnboardingTourProps {
  isActive: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingTour({ isActive, onComplete, onSkip }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  const step = TOUR_STEPS[currentStep];

  // Find and highlight the target element
  useEffect(() => {
    if (!isActive || !step) return;

    const findTarget = () => {
      const target = document.querySelector(step.target) as HTMLElement | null;
      if (target) {
        setTargetElement(target);
        setTargetRect(target.getBoundingClientRect());

        // Add highlight class
        target.setAttribute('data-tour-active', 'true');
      }
    };

    // Initial find
    findTarget();

    // Update position on scroll/resize
    const handleUpdate = () => {
      const target = document.querySelector(step.target) as HTMLElement | null;
      if (target) {
        setTargetRect(target.getBoundingClientRect());
      }
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);

      // Remove highlight from previous target
      if (targetElement) {
        targetElement.removeAttribute('data-tour-active');
      }
    };
  }, [isActive, step, currentStep]);

  // Clean up highlight on unmount or when tour ends
  useEffect(() => {
    return () => {
      if (targetElement) {
        targetElement.removeAttribute('data-tour-active');
      }
    };
  }, [targetElement]);

  const handleNext = useCallback(() => {
    // Remove highlight from current target
    if (targetElement) {
      targetElement.removeAttribute('data-tour-active');
    }

    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Tour complete
      localStorage.setItem(TOUR_STORAGE_KEYS.completed, 'true');
      localStorage.removeItem(TOUR_STORAGE_KEYS.skipped);
      onComplete();
    }
  }, [currentStep, targetElement, onComplete]);

  const handleSkip = useCallback(() => {
    // Remove highlight from current target
    if (targetElement) {
      targetElement.removeAttribute('data-tour-active');
    }

    localStorage.setItem(TOUR_STORAGE_KEYS.skipped, 'true');
    onSkip();
  }, [targetElement, onSkip]);

  // Handle escape key
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSkip();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleSkip]);

  if (!isActive || !step) return null;

  return createPortal(
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-[45] bg-black/50 transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Highlight cutout - creates a "hole" around the target */}
      {targetRect && (
        <div
          className="fixed z-[50] rounded-lg ring-4 ring-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.3)] animate-tour-pulse pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
          aria-hidden="true"
        />
      )}

      {/* Tooltip */}
      <TourTooltip
        step={step}
        currentStep={currentStep}
        totalSteps={TOUR_STEPS.length}
        onNext={handleNext}
        onSkip={handleSkip}
        targetRect={targetRect}
      />
    </>,
    document.body
  );
}
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/OnboardingTour.tsx | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/OnboardingTour.tsx
git commit -m "feat(onboarding): add OnboardingTour controller component"
```

---

## Task 4: Create WelcomeModal Component

**Files:**
- Create: `packages/frontend/src/components/onboarding/WelcomeModal.tsx`

**Step 1: Create the welcome modal component**

```typescript
import { createPortal } from 'react-dom';

interface WelcomeModalProps {
  isOpen: boolean;
  onStartTour: () => void;
  onSkip: () => void;
}

export function WelcomeModal({ isOpen, onStartTour, onSkip }: WelcomeModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-description"
      >
        <div className="p-8 text-center">
          {/* Wave emoji */}
          <div className="text-5xl mb-4">
            <span role="img" aria-label="Wave">👋</span>
          </div>

          {/* Title */}
          <h2 id="welcome-title" className="text-2xl font-bold text-foreground mb-3">
            Welcome to Verbatim Studio
          </h2>

          {/* Description */}
          <p id="welcome-description" className="text-muted-foreground mb-2">
            Your AI-powered workspace for transcription, documents, and intelligent search.
          </p>
          <p className="text-muted-foreground mb-8">
            Would you like a quick tour of the features?
          </p>

          {/* Actions */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={onStartTour}
              className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Start Tour
            </button>
            <button
              onClick={onSkip}
              className="px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/WelcomeModal.tsx | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/WelcomeModal.tsx
git commit -m "feat(onboarding): add WelcomeModal component"
```

---

## Task 5: Create TourSection Component (Dashboard)

**Files:**
- Create: `packages/frontend/src/components/onboarding/TourSection.tsx`

**Step 1: Create the dashboard tour section component**

```typescript
import { TOUR_STORAGE_KEYS } from './tourSteps';

interface TourSectionProps {
  onStartTour: () => void;
}

export function TourSection({ onStartTour }: TourSectionProps) {
  const hasCompletedOrSkipped =
    localStorage.getItem(TOUR_STORAGE_KEYS.completed) === 'true' ||
    localStorage.getItem(TOUR_STORAGE_KEYS.skipped) === 'true';

  if (hasCompletedOrSkipped) {
    // Show subtle "Retake tour" link
    return (
      <div className="text-center py-2">
        <button
          onClick={onStartTour}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Retake the tour
        </button>
      </div>
    );
  }

  // Show full "New to Verbatim Studio?" section
  return (
    <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
      <div className="text-3xl mb-4">
        <span role="img" aria-label="Sparkles">✨</span>
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
        New to Verbatim Studio?
      </h3>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Take a quick guided tour to discover all the features
      </p>
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onStartTour}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          Start Tour
        </button>
        <button
          onClick={() => {
            localStorage.setItem(TOUR_STORAGE_KEYS.skipped, 'true');
            // Force re-render by dispatching a storage event
            window.dispatchEvent(new Event('storage'));
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/TourSection.tsx | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/TourSection.tsx
git commit -m "feat(onboarding): add TourSection component for Dashboard"
```

---

## Task 6: Create Toast Component for Tour Completion

**Files:**
- Create: `packages/frontend/src/components/onboarding/TourToast.tsx`

**Step 1: Create a simple toast component**

```typescript
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface TourToastProps {
  isVisible: boolean;
  onDismiss: () => void;
}

export function TourToast({ isVisible, onDismiss }: TourToastProps) {
  const [isShowing, setIsShowing] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsShowing(true);
      const timer = setTimeout(() => {
        setIsShowing(false);
        setTimeout(onDismiss, 300); // Wait for fade out animation
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onDismiss]);

  if (!isVisible && !isShowing) return null;

  return createPortal(
    <div
      className={`fixed bottom-6 right-6 z-[80] max-w-sm bg-card border border-border rounded-lg shadow-lg p-4 transition-all duration-300 ${
        isShowing ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" role="img" aria-label="Celebration">
          🎉
        </span>
        <div>
          <p className="font-medium text-foreground">You're all set!</p>
          <p className="text-sm text-muted-foreground">
            Start exploring or ask the Assistant if you need help.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/TourToast.tsx | head -20`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/TourToast.tsx
git commit -m "feat(onboarding): add TourToast component for completion celebration"
```

---

## Task 7: Create Index Export

**Files:**
- Create: `packages/frontend/src/components/onboarding/index.ts`

**Step 1: Create the index file**

```typescript
export { OnboardingTour } from './OnboardingTour';
export { WelcomeModal } from './WelcomeModal';
export { TourSection } from './TourSection';
export { TourToast } from './TourToast';
export { TOUR_STEPS, TOUR_STORAGE_KEYS } from './tourSteps';
export type { TourStep } from './tourSteps';
```

**Step 2: Verify file created**

Run: `cat packages/frontend/src/components/onboarding/index.ts`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/onboarding/index.ts
git commit -m "feat(onboarding): add index exports"
```

---

## Task 8: Add CSS Animation for Tour Pulse

**Files:**
- Modify: `packages/frontend/src/index.css`

**Step 1: Add the tour pulse animation to index.css**

Add after the existing `@layer base` block:

```css
@keyframes tour-pulse {
  0%, 100% {
    box-shadow: 0 0 0 4px hsl(var(--primary) / 0.3);
  }
  50% {
    box-shadow: 0 0 0 8px hsl(var(--primary) / 0.5);
  }
}

.animate-tour-pulse {
  animation: tour-pulse 2s ease-in-out infinite;
}

/* Style for highlighted tour elements */
[data-tour-active="true"] {
  position: relative;
  z-index: 51;
}
```

**Step 2: Verify CSS added**

Run: `grep -A 10 "tour-pulse" packages/frontend/src/index.css`

**Step 3: Commit**

```bash
git add packages/frontend/src/index.css
git commit -m "feat(onboarding): add tour pulse CSS animation"
```

---

## Task 9: Add data-tour Attributes to Sidebar

**Files:**
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx`

**Step 1: Add data-tour attribute to NAV_ITEMS nav buttons**

In the nav items map (around line 216), add `data-tour={item.key}` to the button:

Find this code block:
```typescript
<button
  key={item.key}
  onClick={() => handleNavigate(item.key)}
  className={[
```

Replace with:
```typescript
<button
  key={item.key}
  data-tour={item.key}
  onClick={() => handleNavigate(item.key)}
  className={[
```

**Step 2: Add data-tour attribute to Settings button**

Find the Settings button (around line 250):
```typescript
<button
  onClick={() => handleNavigate('settings')}
  className={[
```

Add `data-tour="settings"`:
```typescript
<button
  data-tour="settings"
  onClick={() => handleNavigate('settings')}
  className={[
```

**Step 3: Verify changes**

Run: `grep "data-tour" packages/frontend/src/components/layout/Sidebar.tsx`

Expected output should show `data-tour={item.key}` and `data-tour="settings"`

**Step 4: Commit**

```bash
git add packages/frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(onboarding): add data-tour attributes to Sidebar nav items"
```

---

## Task 10: Add data-tour Attribute to ChatFAB

**Files:**
- Modify: `packages/frontend/src/components/ai/ChatFAB.tsx`

**Step 1: Add data-tour attribute to the FAB button**

Find (around line 21):
```typescript
<button
  onClick={onClick}
  className={`fixed bottom-6 right-6 z-40
```

Add `data-tour="assistant"`:
```typescript
<button
  data-tour="assistant"
  onClick={onClick}
  className={`fixed bottom-6 right-6 z-40
```

**Step 2: Verify change**

Run: `grep "data-tour" packages/frontend/src/components/ai/ChatFAB.tsx`

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ai/ChatFAB.tsx
git commit -m "feat(onboarding): add data-tour attribute to ChatFAB"
```

---

## Task 11: Integrate Onboarding into App.tsx

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Add imports at top of file**

After the existing imports (around line 22), add:
```typescript
import { OnboardingTour, WelcomeModal, TourToast, TOUR_STORAGE_KEYS } from '@/components/onboarding';
```

**Step 2: Add tour state**

After the existing state declarations (around line 128, after `sidebarCollapsed`), add:
```typescript
// Onboarding tour state
const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() => {
  if (typeof window === 'undefined') return false;
  const completed = localStorage.getItem(TOUR_STORAGE_KEYS.completed);
  const skipped = localStorage.getItem(TOUR_STORAGE_KEYS.skipped);
  return !completed && !skipped;
});
const [isTourActive, setIsTourActive] = useState(false);
const [showTourToast, setShowTourToast] = useState(false);
```

**Step 3: Add tour handlers**

After the `handleLoadConversation` callback (around line 339), add:
```typescript
// Tour handlers
const handleStartTour = useCallback(() => {
  setShowWelcomeModal(false);
  setIsTourActive(true);
}, []);

const handleTourComplete = useCallback(() => {
  setIsTourActive(false);
  setShowTourToast(true);
}, []);

const handleTourSkip = useCallback(() => {
  setIsTourActive(false);
  setShowWelcomeModal(false);
}, []);

const handleWelcomeSkip = useCallback(() => {
  localStorage.setItem(TOUR_STORAGE_KEYS.skipped, 'true');
  setShowWelcomeModal(false);
}, []);
```

**Step 4: Add tour components to render**

After the ChatPanel component (around line 522, before the closing `</div>`), add:
```typescript
{/* Onboarding Tour */}
<WelcomeModal
  isOpen={showWelcomeModal && !isConnecting && !error}
  onStartTour={handleStartTour}
  onSkip={handleWelcomeSkip}
/>
<OnboardingTour
  isActive={isTourActive}
  onComplete={handleTourComplete}
  onSkip={handleTourSkip}
/>
<TourToast
  isVisible={showTourToast}
  onDismiss={() => setShowTourToast(false)}
/>
```

**Step 5: Pass startTour to Dashboard**

Update the Dashboard component to pass the tour start handler. First, update the Dashboard props interface (this will be done in Task 12).

For now, update the Dashboard render (around line 441):
```typescript
{navigation.type === 'dashboard' && (
  <Dashboard
    onNavigateToRecordings={handleNavigateToRecordings}
    onNavigateToProjects={handleNavigateToProjects}
    onViewRecording={handleViewTranscript}
    onStartTour={handleStartTour}
  />
)}
```

**Step 6: Verify changes**

Run: `grep -n "Onboarding\|Tour\|Welcome" packages/frontend/src/app/App.tsx | head -20`

**Step 7: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat(onboarding): integrate tour components into App"
```

---

## Task 12: Update Dashboard to Use TourSection

**Files:**
- Modify: `packages/frontend/src/components/dashboard/Dashboard.tsx`

**Step 1: Add import**

After existing imports (around line 8), add:
```typescript
import { TourSection } from '@/components/onboarding/TourSection';
```

**Step 2: Update DashboardProps interface**

Add `onStartTour` to the interface (around line 10):
```typescript
interface DashboardProps {
  onNavigateToRecordings?: () => void;
  onNavigateToProjects?: () => void;
  onViewRecording?: (recordingId: string) => void;
  onRecordingUploaded?: () => void;
  onStartTour?: () => void;
}
```

**Step 3: Destructure the new prop**

Update the function signature (around line 90):
```typescript
export function Dashboard({ onNavigateToRecordings, onNavigateToProjects, onViewRecording, onRecordingUploaded, onStartTour }: DashboardProps) {
```

**Step 4: Replace the "Get Started" section**

Find the existing "Get Started" section (around lines 586-614):
```typescript
{/* Quick Action - Empty State */}
{onNavigateToRecordings && recordings.total_recordings === 0 && (
  <div className="rounded-lg border-2 border-dashed ...
```

Replace the entire block with:
```typescript
{/* Tour Section */}
{onStartTour && (
  <TourSection onStartTour={onStartTour} />
)}
```

**Step 5: Verify changes**

Run: `grep -n "TourSection\|onStartTour" packages/frontend/src/components/dashboard/Dashboard.tsx`

**Step 6: Commit**

```bash
git add packages/frontend/src/components/dashboard/Dashboard.tsx
git commit -m "feat(onboarding): replace Get Started with TourSection in Dashboard"
```

---

## Task 13: Test the Implementation

**Step 1: Start the dev server**

Run: `cd packages/frontend && npm run dev`

**Step 2: Manual testing checklist**

Test in an incognito browser window:

1. [ ] Welcome modal appears on first visit
2. [ ] Clicking "Start Tour" begins the tour
3. [ ] First step highlights Recordings in sidebar
4. [ ] Tooltip shows correct title, description, step counter
5. [ ] Clicking "Next" advances through all 9 steps
6. [ ] Each sidebar item and ChatFAB highlights correctly
7. [ ] Clicking "Finish" on last step shows celebration toast
8. [ ] Toast auto-dismisses after 4 seconds
9. [ ] Dashboard shows "Retake the tour" link after completion
10. [ ] Clicking "Retake the tour" restarts the tour
11. [ ] Pressing Escape skips the tour
12. [ ] Clicking "Skip" at any step ends the tour

**Step 3: Test localStorage persistence**

1. Complete the tour
2. Refresh the page
3. Welcome modal should NOT appear
4. Dashboard should show "Retake the tour" link

**Step 4: Commit any fixes if needed**

---

## Task 14: Final Commit and Cleanup

**Step 1: Verify all files are committed**

Run: `git status`

**Step 2: Create summary commit if any uncommitted changes remain**

```bash
git add -A
git commit -m "feat(onboarding): complete guided tour implementation

Implements #77 - Feature discovery experience for new users

- Welcome modal on first visit
- 9-step sequential tour highlighting sidebar nav + chat assistant
- Pulsing glow animation on highlighted elements
- Dimmed backdrop during tour
- Skip/Next navigation with keyboard support (Escape to skip)
- Celebration toast on completion
- localStorage persistence for completed/skipped state
- Retake tour option on Dashboard"
```

**Step 3: Verify build passes**

Run: `cd packages/frontend && npm run build`

Expected: Build completes without errors

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | tourSteps.ts | Tour step definitions and storage keys |
| 2 | TourTooltip.tsx | Positioned tooltip with step info |
| 3 | OnboardingTour.tsx | Main tour controller with backdrop |
| 4 | WelcomeModal.tsx | First-visit welcome modal |
| 5 | TourSection.tsx | Dashboard section (start/retake tour) |
| 6 | TourToast.tsx | Completion celebration toast |
| 7 | index.ts | Component exports |
| 8 | index.css | Pulse animation CSS |
| 9 | Sidebar.tsx | Add data-tour attributes |
| 10 | ChatFAB.tsx | Add data-tour attribute |
| 11 | App.tsx | Integrate tour components |
| 12 | Dashboard.tsx | Replace Get Started with TourSection |
| 13 | Testing | Manual verification |
| 14 | Cleanup | Final commit |
