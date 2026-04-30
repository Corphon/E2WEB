const SHEET_OPTIONS = ['Sheet1', 'Sheet2', 'Sheet3'];
const CONFIG_CATALOG_PATH = 'configs/catalog.json';
const USER_CONFIGS_STORAGE_KEY = 'e2webUserConfigs';
const extensionApi = globalThis.chrome;
const spreadsheetApi = globalThis.XLSX;

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
const loadConfigButton = document.getElementById('loadConfigButton');
const saveConfigButton = document.getElementById('saveConfigButton');
const deleteConfigButton = document.getElementById('deleteConfigButton');
const uploadDataButton = document.getElementById('uploadDataButton');
const mappingCard = document.getElementById('mappingCard');
const mappingBody = document.getElementById('mappingBody');
const statusEl = document.getElementById('status');
const configPresetSelect = document.getElementById('configPresetSelect');
const configNameInput = document.getElementById('configNameInput');
const excelInput = document.getElementById('excelInput');

identifyButton.addEventListener('click', onIdentifyForm);
loadConfigButton.addEventListener('click', onLoadSelectedConfig);
saveConfigButton.addEventListener('click', onSaveConfig);
deleteConfigButton.addEventListener('click', onDeleteConfig);
uploadDataButton.addEventListener('click', () => excelInput.click());
configPresetSelect.addEventListener('change', onConfigSelectionChange);
excelInput.addEventListener('change', onUploadExcel);

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
    const initialOptionValue = await loadBundledConfigOptions();
    if (initialOptionValue) {
      configPresetSelect.value = initialOptionValue;
      onConfigSelectionChange();
      await onLoadSelectedConfig();
    }
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

    state.fields = fields;
    state.mappings = createDefaultMappings(fields);

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

    const tr = document.createElement('tr');
    tr.dataset.index = String(field.index);

    const sheetOptionsHtml = getSheetOptions(mapping.sheet)
      .map((sheet) => `<option value="${sheet}" ${sheet === mapping.sheet ? 'selected' : ''}>${sheet}</option>`)
      .join('');

    tr.innerHTML = `
      <td>${field.index}</td>
      <td>${escapeHtml(field.label || field.selector || '(Unnamed field)')}</td>
      <td><select class="sheet-select">${sheetOptionsHtml}</select></td>
      <td><input class="cell-input" value="${escapeHtml(mapping.cell || '')}" placeholder="A2" /></td>
    `;

    mappingBody.appendChild(tr);
  }
}

function collectMappingsFromUi() {
  const rows = Array.from(mappingBody.querySelectorAll('tr'));
  const mappings = rows.map((row) => {
    const fieldIndex = Number(row.dataset.index);
    const sheet = row.querySelector('.sheet-select').value;
    const cell = row.querySelector('.cell-input').value.trim().toUpperCase();
    return { fieldIndex, sheet, cell };
  });

  state.mappings = mappings;
  return mappings;
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
  const selectedOption = getSelectedConfigOption();
  const userConfigs = await getUserConfigs();
  const matchedByName = userConfigs.find((item) => {
    return item.projectId === state.currentProjectId
      && item.name.toLowerCase() === name.toLowerCase();
  });
  const editableSelection = selectedOption?.source === 'user'
    ? userConfigs.find((item) => item.id === selectedOption.id)
    : null;
  const existing = editableSelection || matchedByName;

  const config = {
    version: 1,
    name,
    url: state.tabUrl,
    createdAt: existing?.config?.createdAt || now,
    updatedAt: now,
    fields: state.fields,
    mappings
  };

  const nextConfig = {
    id: existing?.id || createConfigId(name),
    name,
    projectId: state.currentProjectId,
    projectLabel: state.currentProjectLabel,
    updatedAt: now,
    config
  };
  const nextUserConfigs = existing
    ? userConfigs.map((item) => item.id === existing.id ? nextConfig : item)
    : [...userConfigs, nextConfig];

  await setUserConfigs(nextUserConfigs);
  await loadBundledConfigOptions(buildConfigOptionValue('user', nextConfig.id));
  setStatus(existing
    ? `Updated saved config: ${name}.`
    : `Saved config: ${name}.`);
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

async function onLoadSelectedConfig() {
  const selectedOption = getSelectedConfigOption();
  if (!selectedOption) {
    setStatus('Select a config first.', true);
    return;
  }

  try {
    let config;
    let configName;

    if (selectedOption.source === 'bundled') {
      config = await fetchExtensionJson(selectedOption.path);
      configName = selectedOption.name || selectedOption.path;
    } else {
      const userConfigs = await getUserConfigs();
      const savedConfig = userConfigs.find((item) => item.id === selectedOption.id);
      if (!savedConfig) {
        throw new Error('The selected saved config was not found.');
      }
      config = savedConfig.config;
      configName = savedConfig.name;
    }

    await applyLoadedConfig(config, configName);
  } catch (error) {
    setStatus(`Failed to load config: ${error.message}`, true);
  }
}

async function onUploadExcel(event) {
  const file = event.target.files?.[0];
  excelInput.value = '';

  if (!file) {
    return;
  }

  if (!state.fields.length) {
    setStatus('Identify a form or load a config before uploading Excel data.', true);
    return;
  }

  try {
    const mappings = collectMappingsFromUi();
    const workbook = spreadsheetApi.read(await file.arrayBuffer(), { type: 'array' });
    const fieldByIndex = new Map(state.fields.map((field) => [field.index, field]));

    const items = [];
    for (const mapping of mappings) {
      if (!mapping.cell) {
        continue;
      }

      const sheet = workbook.Sheets[mapping.sheet] || workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) {
        continue;
      }

      const cellData = sheet[mapping.cell];
      const value = cellData ? formatCellValue(cellData.v) : '';
      const field = fieldByIndex.get(mapping.fieldIndex);

      if (field) {
        items.push({
          index: field.index,
          selector: field.selector,
          value
        });
      }
    }

    if (!items.length) {
      setStatus('No data is available to fill. Check the sheet names and cell mappings.', true);
      return;
    }

    if (!state.tabId) {
      const tab = await getActiveTab();
      state.tabId = tab.id;
    }

    const response = await sendToActiveTab({
      type: 'E2WEB_FILL_FORM',
      items
    });

    const filledCount = response?.filledCount || 0;
    const skippedCount = response?.skippedCount || 0;
    setStatus(`Fill completed: ${filledCount} succeeded, ${skippedCount} skipped or failed.`);
  } catch (error) {
    setStatus(`Upload or fill failed: ${error.message}`, true);
  }
}

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function createDefaultMappings(fields) {
  return fields.map((field) => createDefaultMapping(field));
}

function createDefaultMapping(field) {
  return {
    fieldIndex: field.index,
    sheet: SHEET_OPTIONS[0],
    cell: getDefaultCellForFieldIndex(field.index)
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
  if (!selectedSheet || SHEET_OPTIONS.includes(selectedSheet)) {
    return SHEET_OPTIONS;
  }

  return [selectedSheet, ...SHEET_OPTIONS];
}

async function loadBundledConfigOptions(selectedValue = '') {
  const catalog = await fetchExtensionJson(CONFIG_CATALOG_PATH);
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  const matchedProject = findMatchedProject(projects, state.tabUrl);
  const bundledConfigs = Array.isArray(matchedProject?.configs) ? matchedProject.configs : [];
  const userConfigs = await getUserConfigs();
  const matchingUserConfigs = userConfigs.filter((item) => item.projectId === (matchedProject?.id || 'default'));

  state.currentProjectId = matchedProject?.id || 'default';
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

  const hostnameMatched = !hostnames.length
    || hostnames.includes('*')
    || hostnames.includes(parsedUrl.hostname);
  if (!hostnameMatched) {
    return false;
  }

  return !pathPrefixes.length || pathPrefixes.some((prefix) => parsedUrl.pathname.startsWith(prefix));
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
    item.selected = item.value === selectedValue;
    configPresetSelect.appendChild(item);
  }

  configPresetSelect.disabled = configOptions.length === 0;
  onConfigSelectionChange();
}

function onConfigSelectionChange() {
  const selectedOption = getSelectedConfigOption();
  loadConfigButton.disabled = configPresetSelect.disabled || !selectedOption;
  deleteConfigButton.disabled = !selectedOption || selectedOption.source !== 'user';

  if (!selectedOption) {
    configNameInput.value = '';
    return;
  }

  configNameInput.value = selectedOption.name || '';
}

async function applyLoadedConfig(config, configName) {
  const fields = Array.isArray(config.fields) ? config.fields : [];
  const mappings = Array.isArray(config.mappings) ? config.mappings : [];

  state.fields = fields;
  state.mappings = fields.map((field) => {
    const matchedMapping = mappings.find((item) => item.fieldIndex === field.index);
    return {
      fieldIndex: field.index,
      sheet: matchedMapping?.sheet || SHEET_OPTIONS[0],
      cell: matchedMapping?.cell || getDefaultCellForFieldIndex(field.index)
    };
  });

  if (!state.tabId || !state.tabUrl) {
    const tab = await getActiveTab();
    state.tabId = tab.id;
    state.tabUrl = tab.url || '';
  }

  configNameInput.value = configName || '';
  renderMappings();

  if (!fields.length) {
    setStatus(`Loaded config: ${configName}. No field mappings were stored in this config.`);
    return;
  }

  setStatus(`Loaded config: ${configName}.`);
}

function getSelectedConfigOption() {
  const rawValue = configPresetSelect.value;
  if (!rawValue) {
    return null;
  }

  const [source, identifier] = rawValue.split('::');
  if (!source || !identifier) {
    return null;
  }

  return state.configOptions.find((item) => {
    return item.source === source && String(item.id || item.path) === identifier;
  }) || null;
}

function buildConfigOptionValue(source, identifier) {
  return `${source}::${identifier}`;
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