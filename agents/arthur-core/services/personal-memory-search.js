'use strict';

const STOP_WORDS = new Set(('когда где какой какая какие какое сколько почему зачем как что чем кто ' +
  'мне меня мое моей мою мои моего моих мой моя мною у я по про для на в во с со из и а ' +
  'есть это об обо о ли ты у меня пожалуйста артур сейчас сегодня завтра нужно надо ' +
  'помнишь помню расскажи напомни').split(/\s+/u));

function searchTerms(text) {
  return [...new Set(text.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    .match(/[\p{L}\p{N}]+/gu) || [])]
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
    .map(word => /^[а-я]+$/u.test(word) && word.length >= 5
      ? word.replace(/(?:ами|ями|ого|ему|ому|ыми|ими|ий|ый|ой|ая|ую|ое|ые|ие|ов|ев|ам|ям|ах|ях|а|я|и|ы|у|ю|е)$/u, '')
      : word);
}

// Conservative lexical retrieval: every meaningful query term must match a word.
// No semantic inference, synonym expansion, or automatic note creation.
function relatedNotes(records, query) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return records.filter(record => {
    const words = searchTerms(record.value.text);
    return terms.every(term => words.includes(term));
  });
}

module.exports = { searchTerms, relatedNotes };
