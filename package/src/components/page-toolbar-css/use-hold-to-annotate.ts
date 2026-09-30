import { useCallback, useEffect, useRef } from "react";
import type { createPageEvents } from "../../utils/frame-dom";

/**
 * KeyboardEvent.code of the default hold key: the key left of "1". A bare
 * press and a press combined with a click have no default action in Chrome or
 * Firefox. It is matched by position, so it works on non-Latin layouts too.
 */
export const DEFAULT_HOLD_KEY = "Backquote";

type PageEvents = ReturnType<typeof createPageEvents>;

const NON_TEXT_INPUTS = new Set([
  "button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit",
]);

/** The hold key is text there, or the field keeps it (checkboxes and buttons do not). */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA" || element.tagName === "SELECT") return true;
  return element.tagName === "INPUT" && !NON_TEXT_INPUTS.has((element as HTMLInputElement).type);
}

/** `key` is a KeyboardEvent.code ("Backquote", "F9") or a single character ("g"). */
function matchesHoldKey(event: KeyboardEvent, key: string): boolean {
  return event.code === key || (key.length === 1 && event.key.toLowerCase() === key.toLowerCase());
}

export type HoldToAnnotate = boolean | { key?: string };

export function resolveHoldKey(option: HoldToAnnotate | undefined): string | null {
  if (!option) return null;
  return (typeof option === "object" && option.key) || DEFAULT_HOLD_KEY;
}

/**
 * Feedback mode while a key is held. The hook only turns the mode on when it
 * was off, so it never ends a mode the user toggled themselves.
 *
 * - Key repeat is ignored; only the first physical press counts.
 * - Releasing the key, window blur and a hidden tab all end the hold.
 * - An open popup outlives the key (blur included) because it holds an unsent
 *   draft. The hold then ends when the popup is submitted or cancelled.
 */
export function useHoldToAnnotate({ pageEvents, holdKey, enabled, isActive, popupOpen, activate, deactivate }: {
  pageEvents: PageEvents;
  holdKey: string | null;
  enabled: boolean;
  isActive: boolean;
  popupOpen: boolean;
  activate: () => void;
  deactivate: () => void;
}) {
  const hold = useRef({ keyDown: false, owns: false, code: "" });
  const latest = useRef({ enabled, isActive, popupOpen, activate, deactivate });
  latest.current = { enabled, isActive, popupOpen, activate, deactivate };

  const settle = useCallback(() => {
    const current = hold.current;
    if (!current.owns || current.keyDown || latest.current.popupOpen) return;
    current.owns = false;
    latest.current.deactivate();
  }, []);

  useEffect(() => {
    if (!holdKey) return;
    const current = hold.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesHoldKey(e, holdKey) || e.repeat || e.defaultPrevented || e.isComposing) return;
      // Chords belong to the browser, the OS and the toolbar's own shortcuts.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const state = latest.current;
      if (!state.enabled || state.isActive || state.popupOpen) return;
      if (isTextEntry(e.composedPath()[0] || e.target)) return;
      current.keyDown = true;
      current.owns = true;
      current.code = e.code;
      latest.current.activate();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      // A layout switch mid-hold changes `key`, never the physical `code`.
      if (!matchesHoldKey(e, holdKey) && !(current.keyDown && e.code === current.code)) return;
      current.keyDown = false;
      settle();
    };
    // The keyup may go to another window or tab, so it can never be trusted.
    const handleFocusLoss = () => {
      current.keyDown = false;
      settle();
    };
    const handleVisibility = () => {
      if (document.hidden) handleFocusLoss();
    };

    pageEvents.addEventListener("keydown", handleKeyDown);
    pageEvents.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleFocusLoss);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      pageEvents.removeEventListener("keydown", handleKeyDown);
      pageEvents.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleFocusLoss);
      document.removeEventListener("visibilitychange", handleVisibility);
      // Unmounting or turning the option off mid-hold must not leave the mode on.
      current.keyDown = false;
      if (current.owns) {
        current.owns = false;
        latest.current.deactivate();
      }
    };
  }, [pageEvents, holdKey, settle]);

  // The user left the mode themselves (Escape, Exit button): nothing to release.
  useEffect(() => {
    if (!isActive) hold.current.owns = false;
  }, [isActive]);

  // The popup that kept the mode alive after release is gone.
  useEffect(() => {
    if (!popupOpen) settle();
  }, [popupOpen, settle]);
}
