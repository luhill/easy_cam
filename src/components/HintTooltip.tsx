import type { ReactNode } from 'react';

interface HintTooltipProps {
  text: string;
  placement?: 'top' | 'bottom';
}

export function HintTooltip({ text, placement = 'bottom' }: HintTooltipProps) {
  return (
    <span className={`hint-tooltip${placement === 'top' ? ' hint-tooltip--top' : ''}`}>
      <button
        type="button"
        className="hint-tooltip-trigger"
        aria-label="More info"
        tabIndex={0}
      >
        ?
      </button>
      <span className="hint-tooltip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

interface LabelWithHintProps {
  children: ReactNode;
  hint?: string;
}

export function LabelWithHint({ children, hint }: LabelWithHintProps) {
  return (
    <span className="label-with-hint">
      {children}
      {hint ? <HintTooltip text={hint} /> : null}
    </span>
  );
}
