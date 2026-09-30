import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { PageFeedbackToolbarCSS, type AgentationProps } from "./index";

const shadow = () => document.querySelector("agentation-toolbar")!.shadowRoot! as unknown as HTMLElement;
const ui = () => within(shadow());
const launcher = () => shadow().querySelector<HTMLElement>('[aria-label="Exit"], [aria-label="Start feedback mode"]')!;
const active = () => launcher().getAttribute("aria-expanded") === "true";
const popup = () => shadow().querySelector("[data-annotation-popup]");

const press = (target: Document | Element = document, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: "`", code: "Backquote", ...init });
const release = (target: Document | Element = document, init: KeyboardEventInit = {}) =>
  fireEvent.keyUp(target, { key: "`", code: "Backquote", ...init });
const blurWindow = () => act(() => { window.dispatchEvent(new Event("blur")); });

function holdExit(element: Element) {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  Object.defineProperty(element, "getAnimations", { configurable: true, value: () => [{ finished }] });
  return finish;
}

const originalElementFromPoint = document.elementFromPoint;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() }, userAgent: "test" });
});
afterEach(() => {
  cleanup();
  document.elementFromPoint = originalElementFromPoint;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(props: AgentationProps = { holdToAnnotate: true }) {
  const view = render(<><p>Target</p><a href="#next">Link</a><PageFeedbackToolbarCSS {...props} /></>);
  const target = view.getByText("Target");
  document.elementFromPoint = () => target;
  return { ...view, target };
}

describe("holdToAnnotate", () => {
  it("is active while the key is down and inactive after release", () => {
    mount();
    expect(active()).toBe(false);
    press();
    expect(active()).toBe(true);
    release();
    expect(active()).toBe(false);
  });

  it("is off unless the prop is set", () => {
    mount({});
    press();
    expect(active()).toBe(false);
  });

  it("works under StrictMode's double-mounted effects", () => {
    render(<StrictMode><PageFeedbackToolbarCSS holdToAnnotate /></StrictMode>);
    press();
    expect(active()).toBe(true);
    release();
    expect(active()).toBe(false);
  });

  it("ignores key repeat, during and after the hold", () => {
    mount();
    press();
    press(document, { repeat: true });
    press(document, { repeat: true });
    expect(active()).toBe(true);
    release();
    expect(active()).toBe(false);
    // Repeats that outlive the release (a field lost focus mid-press) must not restart it.
    press(document, { repeat: true });
    expect(active()).toBe(false);
  });

  it("returns to normal on window blur", () => {
    mount();
    press();
    expect(active()).toBe(true);
    blurWindow();
    expect(active()).toBe(false);
    // The keyup that follows the lost focus is harmless.
    release();
    expect(active()).toBe(false);
  });

  it("returns to normal when the tab becomes hidden", () => {
    mount();
    press();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(active()).toBe(true);
    hidden.mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(active()).toBe(false);
  });

  describe("typing", () => {
    it.each([
      ["an input", () => document.createElement("input")],
      ["a textarea", () => document.createElement("textarea")],
      ["a select", () => document.createElement("select")],
      ["a contenteditable element", () => {
        const editable = document.createElement("div");
        // jsdom does not implement isContentEditable.
        Object.defineProperty(editable, "isContentEditable", { value: true });
        return editable;
      }],
    ])("does not activate in %s", (_, create) => {
      mount();
      const field = create();
      document.body.append(field);
      press(field);
      expect(active()).toBe(false);
      release(field);
      expect(active()).toBe(false);
    });

    it("does not start when the press began in a field and focus then moved to the page", () => {
      mount();
      const field = document.createElement("input");
      document.body.append(field);
      press(field);
      press(document, { repeat: true });
      expect(active()).toBe(false);
    });

    it("still activates from a focused checkbox or button, which take no text", () => {
      mount();
      const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
      document.body.append(checkbox);
      press(checkbox);
      expect(active()).toBe(true);
    });
  });

  describe("chords", () => {
    it.each(["ctrlKey", "metaKey", "altKey", "shiftKey"] as const)("ignores the key with %s", (modifier) => {
      mount();
      press(document, { [modifier]: true });
      expect(active()).toBe(false);
    });
  });

  describe("key option", () => {
    it("takes a KeyboardEvent.code", () => {
      mount({ holdToAnnotate: { key: "F9" } });
      press(document, { key: "F9", code: "F9" });
      expect(active()).toBe(true);
      fireEvent.keyUp(document, { key: "F9", code: "F9" });
      expect(active()).toBe(false);
      press();
      expect(active()).toBe(false);
    });

    it("takes a single character on any layout", () => {
      mount({ holdToAnnotate: { key: "g" } });
      press(document, { key: "G", code: "KeyG" });
      expect(active()).toBe(true);
      fireEvent.keyUp(document, { key: "г", code: "KeyG" });
      expect(active()).toBe(false);
    });

    it("falls back to the default key for an empty options object", () => {
      mount({ holdToAnnotate: {} });
      press();
      expect(active()).toBe(true);
    });
  });

  describe("with the mode toggled on by the user", () => {
    it("leaves a toggled mode on after the key is released", () => {
      mount();
      fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
      expect(active()).toBe(true);
      press();
      release();
      expect(active()).toBe(true);
    });

    it("ends the hold with Escape and does not restart it on release", () => {
      mount();
      press();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(active()).toBe(false);
      release();
      expect(active()).toBe(false);
    });
  });

  describe("annotating", () => {
    it("creates a note while held and collapses after the popup is submitted", async () => {
      const onAnnotationAdd = vi.fn();
      const { target } = mount({ holdToAnnotate: true, onAnnotationAdd });
      press();
      fireEvent.click(target, { clientX: 10, clientY: 10 });
      expect(popup()).not.toBeNull();
      release();
      fireEvent.change(ui().getByPlaceholderText("What should change?"), { target: { value: "Held note" } });
      const finish = holdExit(popup()!);
      fireEvent.click(ui().getByRole("button", { name: "Add" }));
      expect(onAnnotationAdd).toHaveBeenCalledWith(expect.objectContaining({ comment: "Held note" }));
      expect(active()).toBe(true);
      await act(async () => finish());
      expect(popup()).toBeNull();
      expect(active()).toBe(false);
    });

    it("keeps an open popup usable after release and blur until it is cancelled", async () => {
      const { target } = mount();
      press();
      fireEvent.click(target, { clientX: 10, clientY: 10 });
      const draft = ui().getByPlaceholderText("What should change?");
      fireEvent.change(draft, { target: { value: "Unsent draft" } });

      release();
      expect(active()).toBe(true);
      expect(popup()).not.toBeNull();
      blurWindow();
      expect(active()).toBe(true);
      expect((ui().getByPlaceholderText("What should change?") as HTMLTextAreaElement).value).toBe("Unsent draft");

      // A new press cannot start a second hold on top of the popup.
      press();
      release();
      expect(active()).toBe(true);

      const finish = holdExit(popup()!);
      fireEvent.click(ui().getByRole("button", { name: "Cancel" }));
      expect(active()).toBe(true);
      await act(async () => finish());
      expect(popup()).toBeNull();
      expect(active()).toBe(false);
    });

    it("stays on while the key is still down after the popup closes", async () => {
      const { target } = mount();
      press();
      fireEvent.click(target, { clientX: 10, clientY: 10 });
      const finish = holdExit(popup()!);
      fireEvent.click(ui().getByRole("button", { name: "Cancel" }));
      await act(async () => finish());
      expect(popup()).toBeNull();
      expect(active()).toBe(true);
      release();
      expect(active()).toBe(false);
    });

    it("swallows a link click while held and lets it through after release", async () => {
      const view = mount();
      const link = view.getByText("Link");
      press();
      // fireEvent returns false when the click was default-prevented.
      expect(fireEvent.click(link)).toBe(false);
      expect(popup()).not.toBeNull();
      const finish = holdExit(popup()!);
      fireEvent.click(ui().getByRole("button", { name: "Cancel" }));
      await act(async () => finish());
      release();
      expect(active()).toBe(false);
      expect(fireEvent.click(link)).toBe(true);
    });

    it("lets a link click navigate normally after a bare press and release", () => {
      const view = mount();
      const link = view.getByText("Link");
      press();
      release();
      expect(fireEvent.click(link)).toBe(true);
      expect(popup()).toBeNull();
    });
  });

  it("stops listening when the option is removed", () => {
    const view = mount();
    press();
    expect(active()).toBe(true);
    view.rerender(<><p>Target</p><PageFeedbackToolbarCSS /></>);
    expect(active()).toBe(false);
    press();
    expect(active()).toBe(false);
  });
});
