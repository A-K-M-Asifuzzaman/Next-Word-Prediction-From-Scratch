"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Candidate, Prediction } from "@/lib/engine/types";

/**
 * The writing surface.
 *
 * Ghost text is drawn by a mirror div sitting behind a transparent-background
 * textarea. Both share identical typography and padding, so the mirror's
 * invisible copy of the text lines the ghost suffix up exactly at the caret --
 * without ever taking control of editing away from the native textarea, which
 * is what makes selection, undo, IME and mobile keyboards keep working.
 */
export function Composer({
  value,
  onChange,
  prediction,
  onAccept,
  ghostEnabled,
  disabled,
  placeholder = "Start writing. The model predicts as you go — press Tab to take its suggestion.",
}: {
  value: string;
  onChange: (v: string) => void;
  prediction: Prediction | null;
  onAccept: (c: Candidate, rank: number) => void;
  ghostEnabled: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [caretAtEnd, setCaretAtEnd] = useState(true);

  const ghost =
    ghostEnabled && caretAtEnd && prediction?.candidates.length
      ? prediction.candidates[0].text
      : "";

  const syncCaret = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    setCaretAtEnd(ta.selectionStart === ta.value.length &&
                  ta.selectionEnd === ta.value.length);
  }, []);

  // Keep the mirror's scroll position glued to the textarea's, or the ghost
  // drifts away from the caret in a long document.
  const syncScroll = useCallback(() => {
    if (mirrorRef.current && taRef.current) {
      mirrorRef.current.scrollTop = taRef.current.scrollTop;
    }
  }, []);

  const accept = useCallback(
    (c: Candidate, rank: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = ta.selectionStart;
      const next = value.slice(0, pos) + c.text + value.slice(ta.selectionEnd);
      onChange(next);
      onAccept(c, rank);
      requestAnimationFrame(() => {
        const p = pos + c.text.length;
        ta.setSelectionRange(p, p);
        ta.focus();
        syncCaret();
      });
    },
    [value, onChange, onAccept, syncCaret],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const cands = prediction?.candidates ?? [];

    if (e.key === "Tab" && !e.shiftKey && ghost && cands.length) {
      e.preventDefault();
      accept(cands[0], 1);
      return;
    }
    // Alt+2..5 reach further down the distribution without leaving the keyboard.
    if (e.altKey && /^[2-5]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (cands[idx]) {
        e.preventDefault();
        accept(cands[idx], idx + 1);
      }
    }
  }

  useEffect(() => {
    syncCaret();
  }, [value, syncCaret]);

  return (
    <div className="relative h-full">
      {/* mirror: invisible copy of the text + the visible ghost suffix */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="prose-surface pointer-events-none absolute inset-0 overflow-hidden px-6 py-5 break-words whitespace-pre-wrap"
      >
        <span className="invisible">{value}</span>
        {ghost && (
          <span className="ghost">
            {ghost}
            <span className="caret text-[var(--signal)]">▌</span>
          </span>
        )}
      </div>

      <textarea
        ref={taRef}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        onSelect={syncCaret}
        onClick={syncCaret}
        onKeyUp={syncCaret}
        placeholder={placeholder}
        className="prose-surface relative h-full w-full resize-none bg-transparent px-6 py-5 text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-muted)]"
      />
    </div>
  );
}
