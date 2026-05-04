const SHEET_OPTIONS = ['Sheet1', 'Sheet2', 'Sheet3'];
const CONFIG_CATALOG_PATH = 'configs/catalog.json';
const USER_CONFIGS_STORAGE_KEY = 'e2webUserConfigs';
const extensionApi = globalThis.chrome;
const spreadsheetApi = globalThis.XLSX;

let _excelSheetNames = [];

const state = {
  tabId: null,
  tabUrl: '',
  fields: [],
  mappings: [],
  configOptions: [],
  currentProjectId: 'default',
  currentProjectLabel: 'Default Project'
};

const identifyButton = document.getElementById('identifyButton');
const saveConfigButton = document.getElementById('saveConfigButton');
const deleteConfigButton = document.getElementById('deleteConfigButton');
const uploadDataButton = document.getElementById('uploadDataButton');
const excelInput = document.getElementById('excelInput');
const mappingCard = document.getElementById('mappingCard');
const mappingBody = document.getElementById('mappingBody');
const statusEl = document.getElementById('status');
const configPresetSelect = document.getElementById('configPresetSelect');
const configNameInput = document.getElementById('configNameInput');

identifyButton.addEventListener('click', onIdentifyForm);
saveConfigButton.addEventListener('click', onSaveConfig);
deleteConfigButton.addEventListener('click', onDeleteConfig);
uploadDataButton.addEventListener('click', () => excelInput?.click());
configPresetSelect.addEventListener('change', onConfigSelectionChange);
excelInput.addEventListener('change', onUploadExcel);
mappingBody.addEventListener('click', onMappingBodyClick);

initializePopup();

async function initializePopup() {
  try {
    const tab = await getActiveTab();
    state.tabId = tab.id;
    state.tabUrl = tab.url || '';
  } catch (_error) {
    state.tabId = null;
    state.tabUrl = '';
  }

  try {
    await loadBundledConfigOptions();
  } catch (error) {
    renderConfigOptions([], 'Catalog Unavailable');
    setStatus(`Failed to initialize config list: ${error.message}`, true);
  }
}

async function onIdentifyForm() {
  try {
    const tab = await getActiveTab();
    state.tabId = tab.id;
    state.tabUrl = tab.url || '';

    const response = await sendToActiveTab({ type: 'E2WEB_IDENTIFY_FORM' });
    const fields = response?.fields || [];

    if (!fields.length) {
      state.fields = [];
      state.mappings = [];
      renderMappings();
      setStatus('No fillable form fields were found on the current page.', true);
      return;
    }

    const previousFields = state.fields;
    const previousMappings = collectMappingsFromState();
    state.fields = fields;
    state.mappings = mergeMappingsForIdentifiedFields(fields, previousFields, previousMappings);

    renderMappings();
    setStatus(`Identified ${fields.length} fields and displayed numbered markers on the page.`);
  } catch (error) {
    setStatus(`Field identification failed: ${error.message}`, true);
  }
}

function renderMappings() {
  mappingBody.innerHTML = '';
  if (!state.fields.length) {
    mappingCard.style.display = 'none';
    return;
  }

  mappingCard.style.display = 'block';
  for (const field of state.fields) {
    const mapping = state.mappings.find((item) => item.fieldIndex === field.index) || createDefaultMapping(field);
    const isIgnored = Boolean(mapping.ignored);

    const tr = document.createElement('tr');
    tr.dataset.index = String(field.index);
    tr.dataset.ignored = String(isIgnored);
    tr.className = isIgnored ? 'mapping-row-ignored' : '';

    const sheetOptionsHtml = getSheetOptions(mapping.sheet)
      .map((sheet) => `<option value="${sheet}" ${sheet === mapping.sheet ? 'selected' : ''}>${sheet}</option>`)
      .join('');

    tr.innerHTML = `
      <td>${field.index}</td>
      <td>${escapeHtml(field.label || field.selector || '(Unnamed field)')}${isIgnored ? '<div><span class="mapping-tag">Ignored</span></div>' : ''}</td>
      <td><select class="sheet-select">${sheetOptionsHtml}</select></td>
      <td><input class="cell-input" value="${escapeHtml(mapping.cell || '')}" placeholder="A2" /></td>
      <td><button type="button" class="row-remove-button ${isIgnored ? 'is-ignored' : ''}" data-field-index="${field.index}">${isIgnored ? 'Unignore' : 'Ignore'}</button></td>
    `;

    mappingBody.appendChild(tr);
  }
}

function onMappingBodyClick(event) {
  const removeButton = event.target.closest('.row-remove-button');
  if (!removeButton) {
    return;
  }

  collectMappingsFromUi();

  const fieldIndex = Number(removeButton.dataset.fieldIndex);
  if (!fieldIndex) {
    return;
  }

  toggleFieldIgnore(fieldIndex);
}

function toggleFieldIgnore(fieldIndex) {
  const targetField = state.fields.find((field) => field.index === fieldIndex);
  if (!targetField) {
    return;
  }

  const existingMapping = state.mappings.find((mapping) => mapping.fieldIndex === fieldIndex) || createDefaultMapping(targetField);
  const nextIgnored = !existingMapping.ignored;

  state.mappings = state.mappings
    .filter((mapping) => mapping.fieldIndex !== fieldIndex)
    .concat({
      ...existingMapping,
      ignored: nextIgnored
    })
    .sort((left, right) => left.fieldIndex - right.fieldIndex);

  renderMappings();
  setStatus(nextIgnored
    ? `Field ${fieldIndex} is now ignored and will not be filled.`
    : `Field ${fieldIndex} will be filled again.`);
}

function collectMappingsFromUi() {
  const rows = Array.from(mappingBody.querySelectorAll('tr'));
  const mappings = rows.map((row) => {
    const fieldIndex = Number(row.dataset.index);
    const sheet = row.querySelector('.sheet-select').value;
    const cell = row.querySelector('.cell-input').value.trim().toUpperCase();
    const ignored = row.dataset.ignored === 'true';
    return { fieldIndex, sheet, cell, ignored };
  });

  state.mappings = mappings;
  return mappings;
}

function collectMappingsFromState() {
  if (!state.mappings.length) {
    return [];
  }

  const rows = Array.from(mappingBody.querySelectorAll('tr'));
  if (!rows.length) {
    return [...state.mappings];
  }

  return collectMappingsFromUi();
}

async function onSaveConfig() {
  if (!state.fields.length) {
    setStatus('No field mappings are available to save. Identify a form first.', true);
    return;
  }

  const name = configNameInput.value.trim();
  if (!name) {
    setStatus('Enter a config name before saving.', true);
    configNameInput.focus();
    return;
  }

  const mappings = collectMappingsFromUi();
  const now = new Date().toISOString();
  const userConfigs = await getUserConfigs();
  const existing = findUserConfigByName(userConfigs, state.currentProjectId, name);
  if (existing) {
    setStatus('Saved configs are immutable. Use a new config name to keep the existing preset unchanged.', true);
    configNameInput.focus();
    configNameInput.select();
    return;
  }

  const config = buildPersistableConfig(state.fields, mappings, {
    name,
    url: state.tabUrl,
    createdAt: now,
    updatedAt: now
  });
  if (!config) {
    setStatus('No valid mapped fields are available to save. Keep only rows with a field, sheet, and cell value.', true);
    return;
  }

  const nextConfig = {
    id: createConfigId(name),
    name,
    projectId: state.currentProjectId,
    projectLabel: state.currentProjectLabel,
    updatedAt: now,
    config
  };
  const nextUserConfigs = [...userConfigs, nextConfig];

  await setUserConfigs(nextUserConfigs);
  await loadBundledConfigOptions(buildConfigOptionValue('user', nextConfig.id));
  setStatus(`Saved config: ${name}.`);
}

async function onDeleteConfig() {
  const selectedOption = getSelectedConfigOption();
  if (!selectedOption) {
    setStatus('Select a saved config before deleting.', true);
    return;
  }

  if (selectedOption.source !== 'user') {
    setStatus('Built-in configs cannot be deleted.', true);
    return;
  }

  const userConfigs = await getUserConfigs();
  const target = userConfigs.find((item) => item.id === selectedOption.id);
  if (!target) {
    setStatus('The selected saved config no longer exists.', true);
    await loadBundledConfigOptions();
    return;
  }

  const nextUserConfigs = userConfigs.filter((item) => item.id !== selectedOption.id);
  await setUserConfigs(nextUserConfigs);
  configNameInput.value = '';
  await loadBundledConfigOptions();
  setStatus(`Deleted saved config: ${target.name}.`);
}

async function onUploadExcel(event) {
  const file = event.target.files?.[0];
  excelInput.value = '';

  if (!file) {
    return;
  }

  try {
    if (!state.fields.length) {
      throw new Error('Identify a form or load a config before uploading a workbook.');
    }

    const tab = await getActiveTab();
    state.tabId = tab.id;
    state.tabUrl = tab.url || '';

    const workbook = spreadsheetApi.read(await file.arrayBuffer(), { type: 'array' });
    _excelSheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    if (_excelSheetNames.length) {
      renderMappings();
    }

    const mappings = collectMappingsFromUi();
    const fillItems = buildFillItemsFromWorkbook(workbook, state.fields, mappings);

    if (!fillItems.length) {
      setStatus(`Loaded workbook ${file.name}, but no mapped Excel values were available to fill.`, true);
      return;
    }

    const result = await sendToActiveTab({ type: 'E2WEB_FILL_FORM', items: fillItems });
    const filledCount = Number(result?.filledCount) || 0;
    const skippedCount = Number(result?.skippedCount) || 0;
    setStatus(`Loaded workbook ${file.name} and filled ${filledCount} fields${skippedCount ? ` (${skippedCount} skipped)` : ''}.`);
  } catch (error) {
    setStatus(`Workbook load failed: ${error.message}`, true);
  }
}

function createDefaultMappings(fields) {
  return fields.map((field) => createDefaultMapping(field));
}

function mergeMappingsForIdentifiedFields(nextFields, previousFields, previousMappings) {
  const previousFieldByIndex = new Map((Array.isArray(previousFields) ? previousFields : []).map((field) => [field.index, field]));
  const mappingGroups = new Map();

  for (const mapping of Array.isArray(previousMappings) ? previousMappings : []) {
    const previousField = previousFieldByIndex.get(Number(mapping?.fieldIndex));
    if (!previousField) {
      continue;
    }

    const matchKey = buildFieldMatchKey(previousField);
    if (!mappingGroups.has(matchKey)) {
      mappingGroups.set(matchKey, []);
    }

    mappingGroups.get(matchKey).push({ previousField, mapping });
  }

  return (Array.isArray(nextFields) ? nextFields : []).map((field) => {
    const matchKey = buildFieldMatchKey(field);
    const candidates = mappingGroups.get(matchKey) || [];
    const matchedCandidate = candidates.shift();
    if (!matchedCandidate) {
      return createDefaultMapping(field);
    }

    return {
      fieldIndex: field.index,
      sheet: String(matchedCandidate.mapping.sheet || SHEET_OPTIONS[0]),
      cell: String(matchedCandidate.mapping.cell || getDefaultCellForFieldIndex(field.index)).trim().toUpperCase(),
      ignored: Boolean(matchedCandidate.mapping.ignored)
    };
  });
}

function buildFieldMatchKey(field) {
  return [
    String(field?.label || '').trim().toLowerCase(),
    String(field?.tagName || '').trim().toLowerCase(),
    String(field?.inputType || '').trim().toLowerCase(),
    normalizeFieldSelectorForMatching(field?.selector)
  ].join('\x01');
}

function normalizeFieldSelectorForMatching(selector) {
  const rawSelector = String(selector || '').trim();
  if (!rawSelector) {
    return '';
  }

  if (rawSelector.startsWith('[data-e2web-idx=')) {
    return '';
  }

  return rawSelector.toLowerCase();
}

function createDefaultMapping(field) {
  return {
    fieldIndex: field.index,
    sheet: SHEET_OPTIONS[0],
    cell: getDefaultCellForFieldIndex(field.index),
    ignored: false
  };
}

function getDefaultCellForFieldIndex(fieldIndex) {
  return `${numberToColumnName(fieldIndex)}2`;
}

function numberToColumnName(index) {
  let value = Number(index) || 1;
  value = Math.max(1, Math.floor(value));

  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

function getSheetOptions(selectedSheet) {
  const baseOptions = _excelSheetNames.length ? _excelSheetNames : SHEET_OPTIONS;

  if (!selectedSheet || baseOptions.includes(selectedSheet)) {
    return baseOptions;
  }

  return [selectedSheet, ...baseOptions];
}

async function loadBundledConfigOptions(selectedValue = '') {
  const catalog = await fetchExtensionJson(CONFIG_CATALOG_PATH);
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  const matchedProject = findMatchedProject(projects, state.tabUrl);
  const bundledConfigs = Array.isArray(matchedProject?.configs) ? matchedProject.configs : [];
  const userConfigs = await getUserConfigs();
  const currentProjectId = matchedProject?.id || 'default';
  const matchingUserConfigs = userConfigs.filter((item) => item.projectId === currentProjectId || !item.projectId || item.projectId === 'default');

  state.currentProjectId = currentProjectId;
  state.currentProjectLabel = matchedProject?.label || 'Default Project';
  state.configOptions = [
    ...bundledConfigs.map((item) => ({
      source: 'bundled',
      path: item.path,
      name: item.label || item.path
    })),
    ...matchingUserConfigs.map((item) => ({
      source: 'user',
      id: item.id,
      name: item.name,
      updatedAt: item.updatedAt
    }))
  ];

  const resolvedSelection = selectedValue || pickInitialConfigOption(state.configOptions);
  renderConfigOptions(state.configOptions, state.currentProjectLabel, resolvedSelection);
  return resolvedSelection;
}

function pickInitialConfigOption(options) {
  if (!Array.isArray(options) || !options.length) {
    return '';
  }

  const userConfigs = options
    .filter((item) => item.source === 'user')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if (userConfigs.length) {
    return buildConfigOptionValue('user', userConfigs[0].id);
  }

  const firstNonTemplate = options.find((item) => {
    if (item.source !== 'bundled') {
      return false;
    }

    const name = String(item.name || '').toLowerCase();
    const path = String(item.path || '').toLowerCase();
    return !name.includes('template') && !path.includes('template');
  });

  if (!firstNonTemplate) {
    return '';
  }

  return buildConfigOptionValue('bundled', firstNonTemplate.path);
}

function findMatchedProject(projects, tabUrl) {
  if (!projects.length) {
    return null;
  }

  let parsedUrl = null;
  try {
    parsedUrl = tabUrl ? new URL(tabUrl) : null;
  } catch (_error) {
    parsedUrl = null;
  }

  return projects.find((project) => doesProjectMatch(project, parsedUrl))
    || projects.find((project) => project.id === 'default')
    || null;
}

function doesProjectMatch(project, parsedUrl) {
  const match = project?.match || {};
  const hostnames = Array.isArray(match.hostnames) ? match.hostnames : [];
  const pathPrefixes = Array.isArray(match.pathPrefixes) ? match.pathPrefixes : [];

  if (!parsedUrl) {
    return project?.id === 'default';
  }

  const hostname = parsedUrl.hostname;
  const pathname = decodeURIComponent(parsedUrl.pathname || '');

  const hostnameMatched = !hostnames.length
    || hostnames.includes('*')
    || hostnames.includes(hostname)
    || hostnames.some((pattern) => matchWildcard(hostname, pattern));
  if (!hostnameMatched) {
    return false;
  }

  return !pathPrefixes.length || pathPrefixes.some((prefix) => {
    const decodedPrefix = decodeURIComponent(prefix);
    return pathname.startsWith(decodedPrefix);
  });
}

function matchWildcard(hostname, pattern) {
  if (!pattern || !pattern.includes('*')) {
    return hostname === pattern;
  }
  const parts = pattern.split('*');
  if (parts.length !== 2) {
    return hostname === pattern;
  }
  const [prefix, suffix] = parts;
  return hostname.startsWith(prefix) && hostname.endsWith(suffix);
}

function renderConfigOptions(configOptions, projectLabel, selectedValue = '') {
  configPresetSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = configOptions.length
    ? `Select a config for ${projectLabel}`
    : `No configs available for ${projectLabel}`;
  configPresetSelect.appendChild(placeholder);

  for (const option of configOptions) {
    const item = document.createElement('option');
    item.value = buildConfigOptionValue(option.source, option.id || option.path);
    item.textContent = option.source === 'user'
      ? `Saved: ${option.name}`
      : `Built-in: ${option.name}`;
    configPresetSelect.appendChild(item);
  }

  configPresetSelect.disabled = configOptions.length === 0;
  configPresetSelect.value = selectedValue || '';
  void onConfigSelectionChange();
}

async function onConfigSelectionChange() {
  const selectedOption = getSelectedConfigOption();
  deleteConfigButton.disabled = !selectedOption || selectedOption.source !== 'user';

  if (!selectedOption) {
    configNameInput.value = '';
    return;
  }

  configNameInput.value = selectedOption.name || '';

   try {
    const config = await loadSelectedConfig(selectedOption);
    applyLoadedConfig(config);
    await syncFieldLabels();
  } catch (error) {
    setStatus(`Config load failed: ${error.message}`, true);
  }
}

function getSelectedConfigOption() {
  const rawValue = configPresetSelect.value;
  if (!rawValue) {
    return null;
  }

  const separatorIndex = rawValue.indexOf('\x00');
  if (separatorIndex < 0) {
    return null;
  }

  const source = rawValue.slice(0, separatorIndex);
  const identifier = rawValue.slice(separatorIndex + 1);
  if (!source || !identifier) {
    return null;
  }

  return state.configOptions.find((item) => {
    return item.source === source && String(item.id || item.path) === identifier;
  }) || null;
}

function buildConfigOptionValue(source, identifier) {
  return `${source}\x00${identifier}`;
}

function buildPersistableConfig(fields, mappings, metadata) {
  const fieldsByIndex = new Map((Array.isArray(fields) ? fields : []).map((field) => [field.index, field]));
  const validMappings = (Array.isArray(mappings) ? mappings : []).filter((mapping) => {
    const field = fieldsByIndex.get(Number(mapping?.fieldIndex));
    return Boolean(
      field?.selector
      && (
        Boolean(mapping?.ignored)
        || (
          String(mapping?.sheet || '').trim()
          && String(mapping?.cell || '').trim()
        )
      )
    );
  }).map((mapping) => ({
    fieldIndex: Number(mapping.fieldIndex),
    sheet: String(mapping.sheet || '').trim(),
    cell: String(mapping.cell || '').trim().toUpperCase(),
    ignored: Boolean(mapping.ignored)
  }));

  if (!validMappings.length) {
    return null;
  }

  const validFieldIndexes = new Set(validMappings.map((mapping) => mapping.fieldIndex));
  const validFields = (Array.isArray(fields) ? fields : []).filter((field) => {
    return validFieldIndexes.has(field.index) && Boolean(String(field.selector || '').trim());
  });

  if (!validFields.length) {
    return null;
  }

  return {
    version: 1,
    name: metadata.name,
    url: metadata.url,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    fields: validFields,
    mappings: validMappings
  };
}

function findUserConfigByName(userConfigs, projectId, name) {
  return (Array.isArray(userConfigs) ? userConfigs : []).find((item) => {
    return item.projectId === projectId && item.name.toLowerCase() === name.toLowerCase();
  }) || null;
}

function buildFillItemsFromWorkbook(workbook, fields, mappings) {
  const fieldsByIndex = new Map((Array.isArray(fields) ? fields : []).map((field) => [field.index, field]));
  const fillItems = [];

  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const field = fieldsByIndex.get(Number(mapping?.fieldIndex));
    if (!field?.selector || !mapping?.cell || mapping?.ignored) {
      continue;
    }

    const cellValue = getWorkbookCellValue(workbook, mapping.sheet, mapping.cell);
    if (cellValue === undefined) {
      continue;
    }

    fillItems.push({
      selector: field.selector,
      value: cellValue
    });
  }

  return fillItems;
}

function getWorkbookCellValue(workbook, sheetName, cellAddress) {
  const worksheet = getWorksheetByName(workbook, sheetName);
  if (!worksheet) {
    return undefined;
  }

  const normalizedAddress = String(cellAddress || '').trim().toUpperCase();
  if (!normalizedAddress) {
    return undefined;
  }

  const cell = worksheet[normalizedAddress];
  if (!cell || cell.t === 'z') {
    return undefined;
  }

  if (cell.w != null) {
    return cell.w;
  }

  if (spreadsheetApi.utils?.format_cell) {
    return spreadsheetApi.utils.format_cell(cell);
  }

  return cell.v;
}

function getWorksheetByName(workbook, sheetName) {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  const sheets = workbook?.Sheets || {};
  const requestedName = String(sheetName || '').trim();

  if (requestedName && sheets[requestedName]) {
    return sheets[requestedName];
  }

  const matchedSheetName = sheetNames.find((name) => name.toLowerCase() === requestedName.toLowerCase());
  if (matchedSheetName && sheets[matchedSheetName]) {
    return sheets[matchedSheetName];
  }

  const fallbackSheetName = requestedName ? '' : sheetNames[0];
  return fallbackSheetName ? sheets[fallbackSheetName] : null;
}

async function loadSelectedConfig(selectedOption) {
  if (selectedOption.source === 'bundled') {
    return fetchExtensionJson(selectedOption.path);
  }

  const userConfigs = await getUserConfigs();
  const matchedConfig = userConfigs.find((item) => item.id === selectedOption.id);
  if (!matchedConfig?.config) {
    throw new Error('The selected saved config no longer exists.');
  }

  return matchedConfig.config;
}

function applyLoadedConfig(config) {
  const fields = normalizeLoadedFields(config?.fields);
  const mappings = Array.isArray(config?.mappings) ? config.mappings : [];

  state.fields = fields;
  state.mappings = fields.map((field) => {
    const matchedMapping = mappings.find((item) => Number(item?.fieldIndex) === field.index);
    if (!matchedMapping) {
      return createDefaultMapping(field);
    }

    return {
      fieldIndex: field.index,
      sheet: String(matchedMapping.sheet || SHEET_OPTIONS[0]),
      cell: String(matchedMapping.cell || getDefaultCellForFieldIndex(field.index)).trim().toUpperCase(),
      ignored: Boolean(matchedMapping.ignored)
    };
  });

  renderMappings();
}

async function syncFieldLabels() {
  try {
    if (!state.tabId) {
      const tab = await getActiveTab();
      state.tabId = tab.id;
      state.tabUrl = tab.url || '';
    }

    await sendToActiveTab({ type: 'E2WEB_RENDER_LABELS', fields: state.fields });
  } catch (_error) {
    // Ignore marker refresh failures so popup editing stays usable on restricted pages.
  }
}

function normalizeLoadedFields(fields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  const usedIndexes = new Set();

  return fields.map((field, index) => {
    let resolvedIndex = Number(field?.index);
    if (!Number.isInteger(resolvedIndex) || resolvedIndex < 1 || usedIndexes.has(resolvedIndex)) {
      resolvedIndex = index + 1;
      while (usedIndexes.has(resolvedIndex)) {
        resolvedIndex += 1;
      }
    }

    usedIndexes.add(resolvedIndex);
    return {
      index: resolvedIndex,
      selector: String(field?.selector || ''),
      label: String(field?.label || ''),
      tagName: String(field?.tagName || ''),
      inputType: String(field?.inputType || '')
    };
  });
}

function createConfigId(name) {
  return `${sanitizeConfigName(name)}-${Date.now()}`;
}

function sanitizeConfigName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'config';
}

function getUserConfigs() {
  return new Promise((resolve, reject) => {
    extensionApi.storage.local.get([USER_CONFIGS_STORAGE_KEY], (result) => {
      if (extensionApi.runtime.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve(Array.isArray(result[USER_CONFIGS_STORAGE_KEY]) ? result[USER_CONFIGS_STORAGE_KEY] : []);
    });
  });
}

function setUserConfigs(configs) {
  return new Promise((resolve, reject) => {
    extensionApi.storage.local.set({ [USER_CONFIGS_STORAGE_KEY]: configs }, () => {
      if (extensionApi.runtime.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

async function fetchExtensionJson(relativePath) {
  const response = await fetch(extensionApi.runtime.getURL(relativePath), { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Unable to read ${relativePath}`);
  }
  return response.json();
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    extensionApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (extensionApi.runtime.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }
      if (!tabs || !tabs[0]) {
        reject(new Error('Unable to access the active tab.'));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendToActiveTab(message) {
  return new Promise(async (resolve, reject) => {
    try {
      const tab = state.tabId ? { id: state.tabId } : await getActiveTab();
      await ensureContentScriptReady(tab.id);
      extensionApi.tabs.sendMessage(tab.id, message, (response) => {
        if (extensionApi.runtime.lastError) {
          reject(new Error(extensionApi.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function ensureContentScriptReady(tabId) {
  try {
    await pingActiveTab(tabId);
    return;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  try {
    await injectContentScript(tabId);
    await pingActiveTab(tabId);
  } catch (error) {
    if (isRestrictedPageError(error)) {
      throw new Error('Content scripts cannot run on this page. Open a regular http/https page and try again.');
    }

    throw error;
  }
}

function pingActiveTab(tabId) {
  return new Promise((resolve, reject) => {
    extensionApi.tabs.sendMessage(tabId, { type: 'E2WEB_PING' }, (response) => {
      if (extensionApi.runtime.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error('Content script ping failed.'));
        return;
      }

      resolve();
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    extensionApi.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }, () => {
      if (extensionApi.runtime.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function isMissingReceiverError(error) {
  const message = String(error?.message || '');
  return message.includes('Receiving end does not exist')
    || message.includes('Could not establish connection');
}

function isRestrictedPageError(error) {
  const message = String(error?.message || '');
  return message.includes('Cannot access')
    || message.includes('Cannot inject script')
    || message.includes('The extensions gallery cannot be scripted')
    || message.includes('Missing host permission');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status ${isError ? 'error' : 'ok'}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
