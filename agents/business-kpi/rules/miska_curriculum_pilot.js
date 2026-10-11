'use strict';

// MISKA original curriculum companion, DRAFT pending source and owner review.
// Maps into the existing canonical modules; does not create courses, tasks or DB rows.
const PILOT = Object.freeze({
  'KNOW-04': Object.freeze({
    key: 'MISKA-NUTR-01',
    title: 'Полнорационный или дополнительный корм',
    guide: [
      'Уточни вид и возраст питомца, затем читай назначение на конкретной упаковке.',
      'Не определяй полнорационность по сухому или влажному формату: проверь маркировку.',
      'При запросе ветеринарной диеты без назначения не подбирай лечение самостоятельно.',
    ],
    practice: 'Для двух фактически присутствующих товаров выпиши указанный на этикетке статус рациона и возрастную категорию.',
    quiz: [
      { question: 'Можно ли определить полнорационность по виду упаковки?', options: ['Да','Нет'], correctIndex: 1 },
      { question: 'Кто определяет лечебную диету при симптомах заболевания?', options: ['Продавец','Ветеринарный врач'], correctIndex: 1 },
    ],
  }),
  'KNOW-05': Object.freeze({
    key: 'MISKA-NUTR-02',
    title: 'Безопасный подбор повседневного корма',
    guide: [
      'Сначала спроси вид, возраст, текущий рацион, цель смены и наличие врачебных рекомендаций.',
      'Сверь назначение и рекомендации по кормлению на этикетке.',
      'При симптомах болезни рекомендуй ветеринарное обследование, не ставь диагноз.',
    ],
    practice: 'Отыграй два диалога: здоровое животное и питомец с симптомами; запиши пять уточняющих вопросов.',
    quiz: [
      { question: 'Можно ли продавцу менять назначенную лечебную диету самостоятельно?', options: ['Да','Нет'], correctIndex: 1 },
    ],
  }),
  'SALE-02': Object.freeze({
    key: 'MISKA-SALE-01',
    title: 'Этичное предложение сопутствующих товаров',
    guide: [
      'Выясни задачу клиента до предложения дополнения.',
      'Не выдавай лакомство за полноценную замену основного рациона.',
      'Объясняй пользу покупки только подтвержденными характеристиками товара.',
    ],
    practice: 'Сыграй два диалога и зафиксируй исходный запрос, уместность предложения и реакцию покупателя.',
    quiz: [
      { question: 'Нужно ли выяснить потребность перед дополнительной продажей?', options: ['Да','Нет'], correctIndex: 0 },
    ],
  }),
});
const REFERENCES = Object.freeze([
  'https://europeanpetfood.org/self-regulation/nutritional-guidelines/',
  'https://wsava.org/global-guidelines/global-nutrition-guidelines/',
  'https://edu.valta.ru/main',
]);
function validatePilot(canonicalCodes) {
  return Object.keys(PILOT).filter(code => !canonicalCodes.includes(code));
}
module.exports = { PILOT, REFERENCES, validatePilot };
