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

  return false;
});

function identifyAndLabelFields() {
  clearOldLabels();

  const elements = getCandidateElements();
  const sorted = elements
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter((item) => isVisible(item.element, item.rect))
    .sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 4) {
        return yDiff;
      }
      return a.rect.left - b.rect.left;
    });

  const container = ensureLabelContainer();
  const fields = [];

  sorted.forEach((item, idx) => {
    const index = idx + 1;
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
    badge.style.left = `${window.scrollX + item.rect.left}px`;
    badge.style.top = `${window.scrollY + item.rect.top}px`;
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

  return fields;
}

function fillFields(items) {
  let filledCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    if (!item?.selector) {
      skippedCount += 1;
      continue;
    }

    const element = document.querySelector(item.selector);
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

function getCandidateElements() {
  return Array.from(document.querySelectorAll(
    'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'
  )).filter((element) => {
    if (element.tagName.toLowerCase() !== 'input') {
      return true;
    }

    const inputType = (element.getAttribute('type') || 'text').toLowerCase();
    return isFillableInputType(inputType);
  });
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

  return true;
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
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    const nodeTag = node.tagName.toLowerCase();
    let part = nodeTag;

    if (node.id) {
      part = `#${cssEscape(node.id)}`;
      path.unshift(part);
      break;
    }

    const siblings = Array.from(node.parentNode?.children || []).filter((child) => child.tagName === node.tagName);
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
      element.checked = checked;
      fireInputEvents(element);
      return true;
    }

    if (inputType === 'radio') {
      const radioName = element.getAttribute('name') || '';
      const normalizedLower = normalizedValue.toLowerCase();

      if (/^(1|true|yes|y|on|check|checked)$/i.test(normalizedValue)) {
        element.checked = true;
        fireInputEvents(element);
        return true;
      }

      if (/^(0|false|no|n|off|uncheck|unchecked)$/i.test(normalizedValue)) {
        element.checked = false;
        fireInputEvents(element);
        return true;
      }

      if (isRadioElementMatched(element, normalizedLower)) {
        element.checked = true;
        fireInputEvents(element);
        return true;
      }

      if (!radioName) {
        return false;
      }

      const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${cssEscape(radioName)}"]`));
      for (const radio of radios) {
        if (!isRadioElementMatched(radio, normalizedLower)) {
          continue;
        }

        radio.checked = true;
        fireInputEvents(radio);
        return true;
      }

      return false;
    }

    element.value = value;
    fireInputEvents(element);
    return true;
  }

  if (element.getAttribute('contenteditable') === 'true') {
    element.textContent = value;
    fireInputEvents(element);
    return true;
  }

  return false;
}

function setSelectValue(selectEl, value) {
  const options = Array.from(selectEl.options);
  const normalized = String(value || '').trim();
  const lower = normalized.toLowerCase();
  const normalizedPercent = normalizePercentCandidate(normalized);

  const exactValue = options.find((opt) => opt.value === normalized);
  if (exactValue) {
    selectEl.value = exactValue.value;
    fireInputEvents(selectEl);
    return true;
  }

  const byCaseInsensitiveValue = options.find((opt) => opt.value.trim().toLowerCase() === lower);
  if (byCaseInsensitiveValue) {
    selectEl.value = byCaseInsensitiveValue.value;
    fireInputEvents(selectEl);
    return true;
  }

  const byText = options.find((opt) => opt.textContent.trim() === normalized);
  if (byText) {
    selectEl.value = byText.value;
    fireInputEvents(selectEl);
    return true;
  }

  const byLooseText = options.find((opt) => opt.textContent.trim().toLowerCase().includes(lower));
  if (lower && byLooseText) {
    selectEl.value = byLooseText.value;
    fireInputEvents(selectEl);
    return true;
  }

  if (normalizedPercent) {
    const byPercentValue = options.find((opt) => opt.value.trim().toLowerCase() === normalizedPercent.toLowerCase());
    if (byPercentValue) {
      selectEl.value = byPercentValue.value;
      fireInputEvents(selectEl);
      return true;
    }

    const byPercentText = options.find((opt) => opt.textContent.trim().toLowerCase().includes(normalizedPercent.toLowerCase()));
    if (byPercentText) {
      selectEl.value = byPercentText.value;
      fireInputEvents(selectEl);
      return true;
    }
  }

  return false;
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

function fireInputEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, '\\$&');
}
