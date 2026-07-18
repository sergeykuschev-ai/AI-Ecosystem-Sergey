function validateInput(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Входные данные должны быть массивом n8n items.');
  }

  items.forEach((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !item.json ||
      typeof item.json !== 'object'
    ) {
      throw new TypeError(
        `Элемент входных данных ${index + 1} должен содержать объект json.`
      );
    }
  });
}

function validateResult(result) {
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    !result[0] ||
    !result[0].json ||
    typeof result[0].json.minmax_text !== 'string'
  ) {
    throw new TypeError(
      'Результат должен содержать один n8n item с полем minmax_text.'
    );
  }
}

module.exports = { validateInput, validateResult };
