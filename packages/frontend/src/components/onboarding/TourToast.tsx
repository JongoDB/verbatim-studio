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
