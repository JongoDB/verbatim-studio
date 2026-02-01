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

  const handleBack = useCallback(() => {
    // Remove highlight from current target
    if (targetElement) {
      targetElement.removeAttribute('data-tour-active');
    }

    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep, targetElement]);

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
        onBack={handleBack}
        onSkip={handleSkip}
        targetRect={targetRect}
      />
    </>,
    document.body
  );
}
