import { cn } from '@/lib/utils';

interface EnterpriseBadgeProps {
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * A badge indicating a feature is only available in the Enterprise plan.
 * Use this component consistently across the app for enterprise-gated features.
 */
export function EnterpriseBadge({ className, size = 'sm' }: EnterpriseBadgeProps) {
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
  };

  const iconSizes = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
  };

  return (
    <span
      className={cn(
        'font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded flex items-center gap-0.5',
        sizeClasses[size],
        className
      )}
    >
      <svg
        className={iconSizes[size]}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
      Enterprise
    </span>
  );
}

interface EnterpriseOnlyWrapperProps {
  children: React.ReactNode;
  className?: string;
  badgePosition?: 'top-right' | 'inline';
  badgeSize?: 'sm' | 'md';
}

/**
 * A wrapper component that marks its children as enterprise-only.
 * Applies disabled styling and positions the EnterpriseBadge.
 */
export function EnterpriseOnlyWrapper({
  children,
  className,
  badgePosition = 'top-right',
  badgeSize = 'sm',
}: EnterpriseOnlyWrapperProps) {
  return (
    <div className={cn('relative opacity-60 cursor-not-allowed', className)}>
      {badgePosition === 'top-right' && (
        <EnterpriseBadge className="absolute top-1 right-1 z-10" size={badgeSize} />
      )}
      <div className="pointer-events-none">{children}</div>
      {badgePosition === 'inline' && <EnterpriseBadge size={badgeSize} />}
    </div>
  );
}
