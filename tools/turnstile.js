// Local substitute for the external widget, shared by A and B.
(() => {
  let sequence = 0;
  const widgets = new Map();
  window.__labTurnstileMode = "valid";
  const emit = options => options.callback?.(window.__labTurnstileMode + "-" + crypto.randomUUID());
  window.turnstile = {
    render(element, options) {
      const id = "lab-" + (++sequence);
      element.style.minHeight = "65px";
      element.dataset.labWidget = id;
      widgets.set(id, options);
      queueMicrotask(() => emit(options));
      return id;
    },
    reset(id) { const options = widgets.get(id); if (options) emit(options); },
  };
})();
