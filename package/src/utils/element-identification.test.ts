import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getElementPath } from "./element-identification";
import { syncAnnotation } from "./sync";

afterEach(() => vi.unstubAllGlobals());

describe("document-level feedback", () => {
  it.each(["body", "html"])("gives %s feedback a nonempty element path", tag => {
    expect(getElementPath(document.querySelector(tag)! as HTMLElement)).toBe(tag);
  });

  it("continues omitting generic wrappers from descendant paths", () => {
    const button = document.body.appendChild(document.createElement("button"));
    try { expect(getElementPath(button)).toBe("button"); } finally { button.remove(); }
  });

  it.each(["body", "html"])("repairs the missing path when retrying older %s feedback", async element => {
    const fetch = vi.fn(async (_url, request) => {
      const annotation = JSON.parse(request.body);
      return { ok: !!annotation.elementPath, status: 400, json: async () => annotation };
    });
    vi.stubGlobal("fetch", fetch);
    const saved = await syncAnnotation("http://local.test", "session", {
      id: "old-note", x: 20, y: 30, comment: "Adjust the page spacing", element,
      elementPath: "", timestamp: Date.now(),
    });
    expect(saved.elementPath).toBe(element);
  });
});

describe("element path generation", () => {
  let container: HTMLDivElement;
  
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  
  afterEach(() => {
    container.remove();
  });
  
  it("resolves CSS modules for Vite format", () => {
    container.innerHTML = `<button class="_caption_o5l98_18"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe(".caption");
  });

  it("resolves CSS modules for Webpack format", () => {
    container.innerHTML = `<button class="App__header___x2y3z"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe(".header");
  });

  it("resolves CSS modules for simple Webpack format", () => {
    container.innerHTML = `<button class="header_container__a1b2c"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe(".container");
  });

  it("falls back to role for elements without classes", () => {
    container.innerHTML = `<button role="tab"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe('button[role="tab"]');
  });

  it("falls back to aria-label for elements without classes", () => {
    container.innerHTML = `<button aria-label="Close dialog"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe('button[aria-label="Close dialog"]');
  });

  it("ignores React generated IDs", () => {
    container.innerHTML = `<button id=":r1:" role="tab"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe('button[role="tab"]');
    
    container.innerHTML = `<button id="_r_2_" aria-label="Close"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe('button[aria-label="Close"]');
  });

  it("uses explicit IDs", () => {
    container.innerHTML = `<button id="submit-btn" role="tab"></button>`;
    expect(getElementPath(container.firstChild as HTMLElement, 1)).toBe('#submit-btn');
  });
});
