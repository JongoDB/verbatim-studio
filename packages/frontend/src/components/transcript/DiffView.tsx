import { wordDiff } from '@/lib/diff';

interface DiffViewProps {
  original: string;
  corrected: string;
}

export function DiffView({ original, corrected }: DiffViewProps) {
  const tokens = wordDiff(original, corrected);

  return (
    <p className="text-xs leading-relaxed">
      {tokens.map((token, i) => {
        if (token.type === 'removed') {
          return (
            <span
              key={i}
              className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through"
            >
              {token.text}
            </span>
          );
        }
        if (token.type === 'added') {
          return (
            <span
              key={i}
              className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
            >
              {token.text}
            </span>
          );
        }
        return (
          <span key={i} className="text-gray-700 dark:text-gray-300">
            {token.text}
          </span>
        );
      })}
    </p>
  );
}
