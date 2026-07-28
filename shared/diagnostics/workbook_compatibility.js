'use strict';

const INVALID_PROFILE_CODE = 'INVALID_COMPATIBILITY_PROFILE';

function invalidProfile(message) {
  const error = new Error(`Некорректный профиль совместимости: ${message}`);
  error.code = INVALID_PROFILE_CODE;
  return error;
}

function validateProfile(profile) {
  if (
    profile === null ||
    typeof profile !== 'object' ||
    Array.isArray(profile)
  ) {
    throw invalidProfile('profile должен быть объектом.');
  }

  if (!Object.prototype.hasOwnProperty.call(profile, 'profileVersion')) {
    throw invalidProfile('поле profileVersion обязательно.');
  }
  if (
    !Number.isInteger(profile.profileVersion) ||
    profile.profileVersion <= 0
  ) {
    throw invalidProfile(
      'поле profileVersion должно быть положительным целым числом.'
    );
  }

  if (!Object.prototype.hasOwnProperty.call(profile, 'requiredWorksheets')) {
    throw invalidProfile('поле requiredWorksheets обязательно.');
  }
  if (!Array.isArray(profile.requiredWorksheets)) {
    throw invalidProfile('поле requiredWorksheets должно быть массивом.');
  }

  const worksheetNames = new Set();
  profile.requiredWorksheets.forEach((worksheet, worksheetIndex) => {
    const worksheetPath = `requiredWorksheets[${worksheetIndex}]`;
    if (
      worksheet === null ||
      typeof worksheet !== 'object' ||
      Array.isArray(worksheet)
    ) {
      throw invalidProfile(`${worksheetPath} должен быть объектом.`);
    }

    if (!Object.prototype.hasOwnProperty.call(worksheet, 'name')) {
      throw invalidProfile(`поле ${worksheetPath}.name обязательно.`);
    }
    if (typeof worksheet.name !== 'string') {
      throw invalidProfile(`поле ${worksheetPath}.name должно быть строкой.`);
    }
    if (worksheet.name.length === 0) {
      throw invalidProfile(
        `поле ${worksheetPath}.name не должно быть пустой строкой.`
      );
    }
    if (worksheetNames.has(worksheet.name)) {
      throw invalidProfile(
        `название листа «${worksheet.name}» указано более одного раза.`
      );
    }
    worksheetNames.add(worksheet.name);

    if (!Object.prototype.hasOwnProperty.call(worksheet, 'requiredColumns')) {
      throw invalidProfile(
        `поле ${worksheetPath}.requiredColumns обязательно.`
      );
    }
    if (!Array.isArray(worksheet.requiredColumns)) {
      throw invalidProfile(
        `поле ${worksheetPath}.requiredColumns должно быть массивом.`
      );
    }

    const requiredColumns = new Set();
    worksheet.requiredColumns.forEach((column, columnIndex) => {
      if (typeof column !== 'string') {
        throw invalidProfile(
          `${worksheetPath}.requiredColumns[${columnIndex}] ` +
          'должен быть строкой.'
        );
      }
      if (requiredColumns.has(column)) {
        throw invalidProfile(
          `обязательная колонка «${column}» листа «${worksheet.name}» ` +
          'указана более одного раза.'
        );
      }
      requiredColumns.add(column);
    });
  });
}

function analyzeWorkbookCompatibility(diagnostics, profile) {
  validateProfile(profile);

  const actualWorksheets = new Map(
    diagnostics.worksheets.map(worksheet => [worksheet.name, worksheet])
  );
  const worksheets = profile.requiredWorksheets.map(requiredWorksheet => {
    const actualWorksheet = actualWorksheets.get(requiredWorksheet.name);
    const found = actualWorksheet !== undefined;
    const actualColumns = found ? [...actualWorksheet.columns] : [];
    const requiredColumns = [...requiredWorksheet.requiredColumns];
    const missingColumns = found
      ? requiredColumns.filter(column => !actualColumns.includes(column))
      : [...requiredColumns];

    return {
      name: requiredWorksheet.name,
      found,
      missingColumns,
      requiredColumns,
      actualColumns,
    };
  });
  const missingWorksheets = worksheets
    .filter(worksheet => !worksheet.found)
    .map(worksheet => worksheet.name);
  const incompatible = worksheets.some(
    worksheet => !worksheet.found || worksheet.missingColumns.length > 0
  );

  return {
    status: incompatible ? 'INCOMPATIBLE' : 'COMPATIBLE',
    profileVersion: profile.profileVersion,
    missingWorksheets,
    worksheets,
  };
}

module.exports = {
  analyzeWorkbookCompatibility,
};
