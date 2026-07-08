import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface HintTooltipProps {
  text: string;
  placement?: 'top' | 'bottom';
}

export function HintTooltip({ text, placement = 'bottom' }: HintTooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const triggerRect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const maxWidth = Math.min(260, window.innerWidth - 16);
    const width = Math.min(Math.max(bubbleRect.width, 1), maxWidth);
    let left = triggerRect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

    const preferTop = placement === 'top';
    let top = preferTop
      ? triggerRect.top - bubbleRect.height - 6
      : triggerRect.bottom + 6;

    if (preferTop && top < 8) {
      top = triggerRect.bottom + 6;
    } else if (!preferTop && top + bubbleRect.height > window.innerHeight - 8) {
      top = triggerRect.top - bubbleRect.height - 6;
    }

    setPosition({ top, left });
    setVisible(true);
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    updatePosition();
  }, [open, text, placement, updatePosition]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span className="hint-tooltip">
      <button
        ref={triggerRef}
        type="button"
        className="hint-tooltip-trigger"
        aria-label="More info"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            className="hint-tooltip-bubble hint-tooltip-bubble--portal"
            style={{
              top: position.top,
              left: position.left,
              visibility: visible ? 'visible' : 'hidden',
            }}
            role="tooltip"
          >
            {text}
          </span>,
          document.body
        )}
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
