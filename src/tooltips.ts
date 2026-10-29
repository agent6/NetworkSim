const actionHints: Record<string, string> = {
  files: "Open or save a lab",
  export: "Download this lab as a YAML file",
  "zoom-reset": "Reset zoom to 100%",
  "connect-device": "Start a cable from this node",
  "tab-console": "Open device consoles",
};

/** Delegation also covers controls created in menus and device dialogs. */
export function setupTooltips(): void {
  const popup = document.createElement("div");
  popup.id = "hover-tooltip";
  popup.className = "app-tooltip";
  popup.setAttribute("role", "tooltip");
  popup.hidden = true;
  document.body.append(popup);

  let active: Element | null = null;
  let showTimer = 0;
  let hideTimer = 0;
  let keyboard = false;

  function targetFor(target: EventTarget | null): Element | null {
    if (!(target instanceof Element) || popup.contains(target) || target.closest('[role="menu"]')) return null;
    // A node's cropped artwork has a larger SVG bounding box than its hit area.
    const device = target.closest("[data-device]");
    if (device) return device.querySelector(".device-body");
    return target.closest(
      '[data-tooltip], button, select, [role="button"], [role="separator"]',
    );
  }

  function description(target: Element): string {
    const title = target.getAttribute("title");
    if (title) {
      target.setAttribute("data-tooltip", title);
      target.removeAttribute("title"); // Avoid a second, native tooltip.
    }
    if (target.classList.contains("device-body"))
      return `${target.getAttribute("aria-label")}\nDouble-click to open · Right-click for actions`;
    if (target.hasAttribute("data-kind"))
      return `${target.getAttribute("data-tooltip") || target.getAttribute("aria-label")}\nClick to add · Drag to position`;
    if (target.hasAttribute("data-link"))
      return `${target.getAttribute("aria-label")}\n${target.querySelector(".wire.down") ? "Link down" : "Link up"} · Double-click for cable settings`;
    const text = target.getAttribute("data-tooltip") ||
      actionHints[target.getAttribute("data-action") || ""] ||
      target.getAttribute("aria-label") ||
      target.textContent?.trim().replace(/\s+/g, " ") || "";
    // Large cards and event rows already expose their full text on screen.
    return text.length <= 200 ? text : "";
  }

  function hide(): void {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    if (active) {
      const ids = (active.getAttribute("aria-describedby") || "")
        .split(/\s+/).filter((id) => id && id !== popup.id);
      if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
      else active.removeAttribute("aria-describedby");
    }
    active = null;
    popup.hidden = true;
  }

  function show(target: Element): void {
    if (active !== target || !target.isConnected) return hide();
    const text = description(target);
    const bounds = target.getBoundingClientRect();
    if (!text || !bounds.width || !bounds.height) return hide();
    popup.textContent = text;
    popup.hidden = false;
    const { width, height } = popup.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(
      window.innerWidth - width - margin,
      bounds.left + bounds.width / 2 - width / 2,
    ));
    const preferredTop = bounds.top - height - margin;
    const top = Math.max(margin, Math.min(
      window.innerHeight - height - margin,
      preferredTop >= margin ? preferredTop : bounds.bottom + margin,
    ));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    const ids = new Set((target.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(Boolean));
    ids.add(popup.id);
    target.setAttribute("aria-describedby", [...ids].join(" "));
  }

  function queue(target: Element | null, immediate = false): void {
    window.clearTimeout(hideTimer);
    if (target === active) {
      if (target && (immediate || popup.hidden)) {
        window.clearTimeout(showTimer);
        if (immediate) show(target);
        else showTimer = window.setTimeout(() => show(target), 350);
      }
      return;
    }
    hide();
    if (!target || !description(target)) return;
    active = target;
    if (immediate) show(target);
    else showTimer = window.setTimeout(() => show(target), 350);
  }

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch" || event.buttons) return;
    if (popup.contains(event.target as Node)) {
      window.clearTimeout(hideTimer);
      return;
    }
    const target = targetFor(event.target);
    if (target) queue(target);
  });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    const next = event.relatedTarget;
    if (next instanceof Node && popup.contains(next)) return;
    if (active && targetFor(next) === active) return;
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 150);
  });
  document.addEventListener("focusin", (event) => {
    if (keyboard) queue(targetFor(event.target), true);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    keyboard = true;
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) hide();
  }, true);
  document.addEventListener("pointerdown", () => {
    keyboard = false;
    hide();
  }, true);
  document.addEventListener("dragstart", hide, true);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
}
