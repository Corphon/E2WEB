const assert = require('assert');

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

function getDefaultCellForFieldIndex(fieldIndex) {
  return `${numberToColumnName(fieldIndex)}2`;
}

function buildConfigOptionValue(source, identifier) {
  return `${source}\x00${identifier}`;
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

function buildLoadedState(config) {
  const fields = normalizeLoadedFields(config?.fields);
  const mappings = Array.isArray(config?.mappings) ? config.mappings : [];

  return {
    fields,
    mappings: fields.map((field) => {
      const matchedMapping = mappings.find((item) => Number(item?.fieldIndex) === field.index);
      if (!matchedMapping) {
        return {
          fieldIndex: field.index,
          sheet: 'Sheet1',
          cell: getDefaultCellForFieldIndex(field.index)
        };
      }

      return {
        fieldIndex: field.index,
        sheet: String(matchedMapping.sheet || 'Sheet1'),
        cell: String(matchedMapping.cell || getDefaultCellForFieldIndex(field.index)).trim().toUpperCase(),
        ignored: Boolean(matchedMapping.ignored)
      };
    })
  };
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

function buildFieldMatchKey(field) {
  return [
    String(field?.label || '').trim().toLowerCase(),
    String(field?.tagName || '').trim().toLowerCase(),
    String(field?.inputType || '').trim().toLowerCase(),
    normalizeFieldSelectorForMatching(field?.selector)
  ].join('\x01');
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
      return {
        fieldIndex: field.index,
        sheet: 'Sheet1',
        cell: getDefaultCellForFieldIndex(field.index),
        ignored: false
      };
    }

    return {
      fieldIndex: field.index,
      sheet: String(matchedCandidate.mapping.sheet || 'Sheet1'),
      cell: String(matchedCandidate.mapping.cell || getDefaultCellForFieldIndex(field.index)).trim().toUpperCase(),
      ignored: Boolean(matchedCandidate.mapping.ignored)
    };
  });
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

  return cell.v;
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

function assertEqual(actual, expected, label) {
  assert.strictEqual(actual, expected, label);
}

function run() {
  assertEqual(getDefaultCellForFieldIndex(1), 'A2', 'field 1 maps to A2');
  assertEqual(getDefaultCellForFieldIndex(27), 'AA2', 'field 27 maps to AA2');
  assertEqual(buildConfigOptionValue('user', 'abc'), 'user\x00abc', 'config option value uses null separator');

  assertEqual(doesProjectMatch({ id: 'default' }, null), true, 'default project matches missing url');
  assertEqual(doesProjectMatch({ match: { hostnames: ['example.com'] } }, new URL('https://example.com/a')), true, 'hostname match');
  assertEqual(doesProjectMatch({ match: { hostnames: ['*.example.com'] } }, new URL('https://app.example.com/a')), true, 'wildcard hostname match');
  assertEqual(doesProjectMatch({ match: { pathPrefixes: ['/foo'] } }, new URL('https://example.com/foo/bar')), true, 'path prefix match');
  assertEqual(doesProjectMatch({ match: { pathPrefixes: ['/foo'] } }, new URL('https://example.com/bar')), false, 'path prefix miss');

  const loadedState = buildLoadedState({
    fields: [
      { index: 2, selector: '#name', label: 'Name', tagName: 'input', inputType: 'text' },
      { selector: '#age', label: 'Age', tagName: 'input', inputType: 'text' }
    ],
    mappings: [
      { fieldIndex: 2, sheet: 'Applicants', cell: 'b4', ignored: true }
    ]
  });

  assertEqual(loadedState.fields.length, 2, 'loaded config preserves field count');
  assertEqual(loadedState.fields[1].index, 3, 'missing field index falls back to the next available order');
  assertEqual(loadedState.mappings[0].cell, 'B4', 'saved cell references are normalized to uppercase');
  assertEqual(loadedState.mappings[0].ignored, true, 'saved ignored flags are preserved when loading a config');
  assertEqual(loadedState.mappings[1].cell, 'C2', 'missing mapping falls back to default cell for field index');

  const mergedMappings = mergeMappingsForIdentifiedFields(
    [
      { index: 1, selector: '[data-e2web-idx="1"]', label: 'Name', tagName: 'input', inputType: 'text' },
      { index: 2, selector: '[data-e2web-idx="2"]', label: 'Age', tagName: 'input', inputType: 'text' }
    ],
    [
      { index: 5, selector: '[data-e2web-idx="5"]', label: 'Name', tagName: 'input', inputType: 'text' },
      { index: 6, selector: '[data-e2web-idx="6"]', label: 'Age', tagName: 'input', inputType: 'text' }
    ],
    [
      { fieldIndex: 5, sheet: 'Applicants', cell: 'B4', ignored: true },
      { fieldIndex: 6, sheet: 'Applicants', cell: 'C4', ignored: false }
    ]
  );

  assertEqual(mergedMappings[0].ignored, true, 're-identify preserves ignored flags for matching fields');
  assertEqual(mergedMappings[0].cell, 'B4', 're-identify preserves mapped cells for matching fields');
  assertEqual(mergedMappings[1].cell, 'C4', 're-identify preserves non-ignored mappings too');

  const fillItems = buildFillItemsFromWorkbook(
    {
      SheetNames: ['Applicants'],
      Sheets: {
        Applicants: {
          A2: { v: 'Alice' },
          B2: { w: '50%' }
        }
      }
    },
    [
      { index: 1, selector: '#name' },
      { index: 2, selector: '#ratio' }
    ],
    [
      { fieldIndex: 1, sheet: 'applicants', cell: 'a2' },
      { fieldIndex: 2, sheet: 'Applicants', cell: 'B2', ignored: true },
      { fieldIndex: 3, sheet: 'Applicants', cell: 'C2' }
    ]
  );

  assertEqual(fillItems.length, 1, 'ignored mappings are excluded from fill items even when workbook values exist');
  assertEqual(fillItems[0].value, 'Alice', 'raw workbook values are returned when no formatted text exists');

  const persistableConfig = buildPersistableConfig(
    [
      { index: 1, selector: '#name', label: 'Name' },
      { index: 2, selector: '#unused', label: 'Unused' },
      { index: 3, selector: '', label: 'Broken' }
    ],
    [
      { fieldIndex: 1, sheet: 'Applicants', cell: ' a2 ' },
      { fieldIndex: 2, sheet: '', cell: '', ignored: true },
      { fieldIndex: 3, sheet: 'Applicants', cell: 'C2' }
    ],
    {
      name: 'Active Only',
      url: 'https://example.com/form',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z'
    }
  );

  assertEqual(persistableConfig.fields.length, 2, 'ignored fields are persisted so the ignore tag survives reload');
  assertEqual(persistableConfig.mappings.length, 2, 'ignored mappings are persisted even without sheet and cell values');
  assertEqual(persistableConfig.mappings[0].cell, 'A2', 'persisted cells are normalized to uppercase');
  assertEqual(persistableConfig.mappings[1].ignored, true, 'persisted mappings retain the ignored flag');

  const existingConfig = findUserConfigByName(
    [
      { projectId: 'default', name: 'Daily Form' },
      { projectId: 'other', name: 'Daily Form' }
    ],
    'default',
    'daily form'
  );

  assertEqual(existingConfig.name, 'Daily Form', 'name conflict check is case-insensitive within the current project');

  console.log('All tests passed.');
}

run();
