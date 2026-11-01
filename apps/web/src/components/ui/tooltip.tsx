import { type ReactNode, useId, useRef, useState } from "react";

interface TooltipProps {
  /** 悬浮提示内容 */
  label: string;
  /** 触发元素（图标等） */
  children: ReactNode;
}

/**
 * 轻量悬浮提示
 *
 * 用 `position: fixed` 渲染，避免被卡片的 `overflow-y: auto` 裁掉。
 */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<
    { left: number; top: number } | null
  >(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 6 });
  };

  const hide = () => setPosition(null);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      aria-describedby={position ? id : undefined}
      className="inline-flex cursor-help items-center outline-none"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {position && (
        <span
          id={id}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
          className="pointer-events-none fixed z-50 w-60 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-2 text-[11px] leading-relaxed text-popover-foreground shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
  );
}
