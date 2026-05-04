const LABEL_CONTAINER_ID = 'e2web-form-label-container';
const extensionApi = globalThis.chrome;

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'E2WEB_PING') {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'E2WEB_IDENTIFY_FORM') {
    const fields = identifyAndLabelFields();
    sendResponse({ fields });
    return true;
  }

  if (message?.type === 'E2WEB_FILL_FORM') {
    const result = fillFields(message.items || []);
    sendResponse(result);
    return true;
  }

  if (message?.type === 'E2WEB_RENDER_LABELS') {
    const fields = renderProvidedFields(message.fields || []);
    sendResponse({ fieldsCount: fields.length });
    return true;
  }

  return false;
});

function identifyAndLabelFields() {
  clearOldLabels();
  stopLabelObserver();

  const elements = getCandidateElements();
  const sorted = elements
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const pageRect = getPageRect(element, rect);
      return { element, rect, pageRect };
    })
    .filter((item) => isVisible(item.element, item.rect))
    .sort((a, b) => {
      const yDiff = a.pageRect.top - b.pageRect.top;
      if (Math.abs(yDiff) > 4) {
        return yDiff;
      }
      return a.pageRect.left - b.pageRect.left;
    });

  const container = ensureLabelContainer();
  const fields = [];

  sorted.forEach((item, idx) => {
    const index = idx + 1;
    // Assign stable data attribute for selector fallback
    item.element.dataset.e2webIdx = String(index);
    const selector = buildSelector(item.element);
    if (!selector) {
      return;
    }

    const label = inferFieldLabel(item.element);
    fields.push({
      index,
      selector,
      label,
      tagName: item.element.tagName.toLowerCase(),
      inputType: getInputType(item.element)
    });

    const badge = document.createElement('div');
    badge.textContent = String(index);
    badge.style.position = 'absolute';
    badge.style.left = `${window.scrollX + item.pageRect.left}px`;
    badge.style.top = `${window.scrollY + item.pageRect.top}px`;
    badge.style.transform = 'translate(-45%, -55%)';
    badge.style.background = '#1d4ed8';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '700';
    badge.style.lineHeight = '16px';
    badge.style.minWidth = '16px';
    badge.style.textAlign = 'center';
    badge.style.borderRadius = '10px';
    badge.style.padding = '1px 5px';
    badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)';
    badge.style.pointerEvents = 'none';
    badge.style.zIndex = '2147483647';
    container.appendChild(badge);
  });

  startLabelObserver(fields);
  return fields;
}

function renderProvidedFields(fields) {
  clearOldLabels();
  stopLabelObserver();

  const validFields = (Array.isArray(fields) ? fields : []).filter((field) => {
    return Number.isInteger(Number(field?.index)) && Boolean(String(field?.selector || '').trim());
  }).map((field) => ({
    index: Number(field.index),
    selector: String(field.selector),
    label: String(field.label || ''),
    tagName: String(field.tagName || ''),
    inputType: String(field.inputType || '')
  }));

  if (!validFields.length) {
    return [];
  }

  refreshBadges(validFields);
  startLabelObserver(validFields);
  return validFields;
}

function fillFields(items) {
  let filledCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    if (!item?.selector) {
      skippedCount += 1;
      continue;
    }

    const element = querySelectorDeep(item.selector);
    if (!element) {
      skippedCount += 1;
      continue;
    }

    try {
      const ok = setElementValue(element, item.value);
      if (ok) {
        filledCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (_error) {
      skippedCount += 1;
    }
  }

  return { filledCount, skippedCount };
}

function querySelectorDeep(selector, root) {
  const doc = root || document;

  // Try main document / current root
  const el = doc.querySelector(selector);
  if (el) return el;

  // Search through same-origin iframes
  const iframes = doc.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const found = querySelectorDeep(selector, iframeDoc);
        if (found) return found;
      }
    } catch (_e) {
      // Cross-origin — skip
    }
  }

  return null;
}

function getPageRect(element, rect) {
  const ownerDoc = element.ownerDocument;
  if (!ownerDoc || ownerDoc === document) {
    return { top: rect.top, left: rect.left };
  }

  // Find the iframe that contains this document
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc === ownerDoc) {
        const iframeRect = iframe.getBoundingClientRect();
        return {
          top: iframeRect.top + rect.top,
          left: iframeRect.left + rect.left
        };
      }
    } catch (_e) { /* cross-origin */ }
  }

  return { top: rect.top, left: rect.left };
}

function getCandidateElements(root) {
  const doc = root || document;
  const elements = Array.from(doc.querySelectorAll(
    'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'
  )).filter((element) => {
    if (element.tagName.toLowerCase() !== 'input') {
      return true;
    }
    const inputType = (element.getAttribute('type') || 'text').toLowerCase();
    return isFillableInputType(inputType);
  });

  // Recurse into open shadow roots
  const shadowHosts = doc.querySelectorAll('*');
  for (const host of shadowHosts) {
    if (host.shadowRoot) {
      elements.push(...getCandidateElements(host.shadowRoot));
    }
  }

  // Recurse into same-origin iframes
  const iframes = doc.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        elements.push(...getCandidateElements(iframeDoc));
      }
    } catch (_e) {
      // Cross-origin iframe — skip
    }
  }

  return elements;
}

function isFillableInputType(inputType) {
  return ![
    'hidden',
    'button',
    'submit',
    'reset',
    'file',
    'image'
  ].includes(inputType);
}

function isVisible(element, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  // clip-path hidden
  const clipPath = style.clipPath;
  if (clipPath && clipPath !== 'none' && clipPath.startsWith('inset(0px')) {
    return false;
  }

  // overflow:hidden and element outside container
  const parent = element.parentElement;
  if (parent) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.overflow === 'hidden' || parentStyle.overflowX === 'hidden' || parentStyle.overflowY === 'hidden') {
      const parentRect = parent.getBoundingClientRect();
      if (rect.right < parentRect.left || rect.left > parentRect.right ||
          rect.bottom < parentRect.top || rect.top > parentRect.bottom) {
        return false;
      }
    }
  }

  // position:fixed off-screen
  if (style.position === 'fixed') {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) {
      return false;
    }
  }

  // height:0 / max-height:0 containers
  if (style.height === '0px' || style.maxHeight === '0px') {
    return false;
  }

  return true;
}

let _labelObserver = null;
let _labelResizeHandler = null;

function stopLabelObserver() {
  if (_labelObserver) {
    _labelObserver.disconnect();
    _labelObserver = null;
  }
  if (_labelResizeHandler) {
    window.removeEventListener('resize', _labelResizeHandler);
    window.removeEventListener('scroll', _labelResizeHandler);
    _labelResizeHandler = null;
  }
}

function startLabelObserver(fields) {
  stopLabelObserver();

  const debouncedRefresh = debounce(() => {
    refreshBadges(fields);
  }, 150);

  _labelResizeHandler = debouncedRefresh;
  window.addEventListener('resize', debouncedRefresh);
  window.addEventListener('scroll', debouncedRefresh);

  _labelObserver = new MutationObserver((mutations) => {
    let shouldRefresh = false;
    for (const m of mutations) {
      if (m.type === 'childList' || m.type === 'attributes') {
        shouldRefresh = true;
        break;
      }
    }
    if (shouldRefresh) {
      debouncedRefresh();
    }
  });

  _labelObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden']
  });
}

function refreshBadges(fields) {
  clearOldLabels();
  const container = ensureLabelContainer();
  fields.forEach((field) => {
    const el = querySelectorDeep(field.selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) return;
    const pageRect = getPageRect(el, rect);

    const badge = document.createElement('div');
    badge.textContent = String(field.index);
    badge.style.position = 'absolute';
    badge.style.left = `${window.scrollX + pageRect.left}px`;
    badge.style.top = `${window.scrollY + pageRect.top}px`;
    badge.style.transform = 'translate(-45%, -55%)';
    badge.style.background = '#1d4ed8';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '700';
    badge.style.width = '22px';
    badge.style.height = '22px';
    badge.style.borderRadius = '50%';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.zIndex = '2147483647';
    badge.style.pointerEvents = 'none';
    badge.style.boxShadow = '0 0 0 2px #ffffff';
    container.appendChild(badge);
  });
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function clearOldLabels() {
  const old = document.getElementById(LABEL_CONTAINER_ID);
  if (old) {
    old.remove();
  }
}

function ensureLabelContainer() {
  const container = document.createElement('div');
  container.id = LABEL_CONTAINER_ID;
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = `${Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)}px`;
  container.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
  container.style.pointerEvents = 'none';
  container.style.zIndex = '2147483647';
  document.documentElement.appendChild(container);
  return container;
}

function inferFieldLabel(element) {
  const byAria = element.getAttribute('aria-label');
  if (byAria) {
    return byAria.trim();
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refEl = document.getElementById(labelledBy.trim());
    if (refEl?.textContent?.trim()) {
      return refEl.textContent.trim();
    }
  }

  const byPlaceholder = element.getAttribute('placeholder');
  if (byPlaceholder) {
    return byPlaceholder.trim();
  }

  if (element.id) {
    const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
    if (label?.textContent?.trim()) {
      return label.textContent.trim();
    }
  }

  // Nested label: label wraps the input
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const text = parentLabel.textContent?.trim();
    if (text) {
      // Remove the input's own text content if present inside the label
      const inputText = element.textContent || '';
      const cleaned = text.replace(inputText, '').trim();
      if (cleaned) return cleaned;
      return text;
    }
  }

  const byTitle = element.getAttribute('title');
  if (byTitle) {
    return byTitle.trim();
  }

  if (element.name) {
    return element.name;
  }

  return `${element.tagName.toLowerCase()} field`;
}

function getInputType(element) {
  if (element.tagName.toLowerCase() !== 'input') {
    return element.tagName.toLowerCase();
  }
  return element.getAttribute('type') || 'text';
}

function buildSelector(element) {
  // Use data attribute for stable identification across DOM changes
  if (element.dataset && element.dataset.e2webIdx) {
    return `[data-e2web-idx="${cssEscape(element.dataset.e2webIdx)}"]`;
  }

  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const tag = element.tagName.toLowerCase();
  const name = element.getAttribute('name');
  if (name) {
    const selector = `${tag}[name="${cssEscape(name)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  const path = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    const nodeTag = node.tagName.toLowerCase();
    let part = nodeTag;

    if (node.id) {
      part = `#${cssEscape(node.id)}`;
      path.unshift(part);
      break;
    }

    const parent = node.parentNode;
    const siblings = Array.from(parent?.children || []).filter((child) => child.tagName === node.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(node) + 1;
      part += `:nth-of-type(${idx})`;
    }

    path.unshift(part);
    node = node.parentElement;
  }

  if (!path.length) {
    return null;
  }

  return path.join(' > ');
}

function setElementValue(element, rawValue) {
  const value = rawValue == null ? '' : String(rawValue);
  const normalizedValue = value.trim();
  const tag = element.tagName.toLowerCase();

  if (tag === 'select') {
    return setSelectValue(element, normalizedValue);
  }

  if (tag === 'textarea' || tag === 'input') {
    const inputType = (element.getAttribute('type') || 'text').toLowerCase();

    if (inputType === 'checkbox') {
      const checked = /^(1|true|yes|y|on)$/i.test(normalizedValue);
      setNativeChecked(element, checked);
      fireFullEventChain(element, 'checkbox');
      return true;
    }

    if (inputType === 'radio') {
      return setRadioValue(element, normalizedValue);
    }

    setNativeValue(element, value);
    fireFullEventChain(element, inputType);
    return true;
  }

  if (element.getAttribute('contenteditable') === 'true') {
    element.innerHTML = value;
    fireFullEventChain(element, 'contenteditable');
    return true;
  }

  return false;
}

function setRadioValue(element, normalizedValue) {
  const radioName = element.getAttribute('name') || '';
  const normalizedLower = normalizedValue.toLowerCase();

  // Text/label matching first (higher priority than boolean keywords)
  if (normalizedLower) {
    const allRadios = radioName
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${cssEscape(radioName)}"]`))
      : [element];

    for (const radio of allRadios) {
      if (isRadioElementMatched(radio, normalizedLower)) {
        setNativeChecked(radio, true);
        fireFullEventChain(radio, 'radio');
        return true;
      }
    }
  }

  // Boolean keywords as fallback
  if (/^(1|true|yes|y|on|check|checked)$/i.test(normalizedValue)) {
    setNativeChecked(element, true);
    fireFullEventChain(element, 'radio');
    return true;
  }

  if (/^(0|false|no|n|off|uncheck|unchecked)$/i.test(normalizedValue)) {
    setNativeChecked(element, false);
    fireFullEventChain(element, 'radio');
    return true;
  }

  return false;
}

function setSelectValue(selectEl, value) {
  const options = Array.from(selectEl.options);
  const normalized = String(value || '').trim();
  const lower = normalized.toLowerCase();

  // Only attempt percent normalization if the select options contain percentage values
  const normalizedPercent = hasPercentOptions(options) ? normalizePercentCandidate(normalized) : '';

  const exactValue = options.find((opt) => opt.value === normalized);
  if (exactValue) {
    selectEl.value = exactValue.value;
    fireFullEventChain(selectEl, 'select');
    return true;
  }

  const byCaseInsensitiveValue = options.find((opt) => opt.value.trim().toLowerCase() === lower);
  if (byCaseInsensitiveValue) {
    selectEl.value = byCaseInsensitiveValue.value;
    fireFullEventChain(selectEl, 'select');
    return true;
  }

  const byText = options.find((opt) => opt.textContent.trim() === normalized);
  if (byText) {
    selectEl.value = byText.value;
    fireFullEventChain(selectEl, 'select');
    return true;
  }

  const byLooseText = findBestLooseTextMatch(options, lower);
  if (lower && byLooseText) {
    selectEl.value = byLooseText.value;
    fireFullEventChain(selectEl, 'select');
    return true;
  }

  if (normalizedPercent) {
    const byPercentValue = options.find((opt) => opt.value.trim().toLowerCase() === normalizedPercent.toLowerCase());
    if (byPercentValue) {
      selectEl.value = byPercentValue.value;
      fireFullEventChain(selectEl, 'select');
      return true;
    }

    const byPercentText = findBestLooseTextMatch(options, normalizedPercent.toLowerCase());
    if (byPercentText) {
      selectEl.value = byPercentText.value;
      fireFullEventChain(selectEl, 'select');
      return true;
    }
  }

  return false;
}

function hasPercentOptions(options) {
  return options.some((opt) => {
    const text = String(opt.textContent || '').trim();
    const val = String(opt.value || '').trim();
    return text.includes('%') || val.includes('%');
  });
}

function findBestLooseTextMatch(options, lower) {
  if (!lower) return null;

  const matches = options.filter((opt) => opt.textContent.trim().toLowerCase().includes(lower));
  if (!matches.length) return null;

  // Pick the shortest matching text to reduce ambiguity
  matches.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
  return matches[0];
}

function normalizePercentCandidate(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (/^\d+(\.\d+)?%$/.test(trimmed)) {
    const numberPart = Number(trimmed.replace('%', ''));
    return `${stripTrailingZeros(numberPart)}%`;
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return '';
  }

  const numeric = Number(trimmed);
  if (Number.isNaN(numeric)) {
    return '';
  }

  if (numeric >= 0 && numeric <= 1) {
    return `${stripTrailingZeros(numeric * 100)}%`;
  }

  if (numeric > 1 && numeric <= 100) {
    return `${stripTrailingZeros(numeric)}%`;
  }

  return '';
}

function stripTrailingZeros(value) {
  return Number(value.toFixed(6)).toString();
}

function isRadioElementMatched(radio, normalizedLowerValue) {
  if (!normalizedLowerValue) {
    return false;
  }

  const candidates = [
    radio.value,
    radio.id,
    radio.getAttribute('name'),
    inferFieldLabel(radio)
  ];

  return candidates.some((candidate) => String(candidate || '').trim().toLowerCase() === normalizedLowerValue);
}

function setNativeValue(element, value) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  } else {
    element.value = value;
  }
}

function setNativeChecked(element, checked) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, checked);
  } else {
    element.checked = checked;
  }
}

function fireFullEventChain(element, type) {
  const tag = element.tagName.toLowerCase();
  const inputType = tag === 'input' ? (element.getAttribute('type') || 'text').toLowerCase() : tag;

  // Focus first
  if (typeof element.focus === 'function') {
    element.focus();
  }

  // Keydown/Keyup for text-like inputs
  if (['text', 'password', 'email', 'tel', 'url', 'search', 'number', 'textarea', 'contenteditable'].includes(inputType)) {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
  }

  // Input event with data for React/Vue compatibility
  element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: element.value || '' }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function fireInputEvents(element) {
  fireFullEventChain(element, element.tagName.toLowerCase());
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }

  return polyfillCssEscape(String(value));
}

function polyfillCssEscape(value) {
  if (!value) return value;
  let result = '';
  const first = value.charCodeAt(0);
  // CSS identifiers cannot start with a digit or hyphen+digit
  if (first >= 0x30 && first <= 0x39) {
    result += '\\3' + value.charAt(0) + ' ';
    value = value.slice(1);
  }
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    // Allow alphanumeric, hyphen, underscore
    if ((code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || code === 0x2d
      || code === 0x5f) {
      result += ch;
    } else if (code < 0x80) {
      result += '\\' + ch;
    } else {
      result += '\\' + code.toString(16) + ' ';
    }
  }
  return result;
}
