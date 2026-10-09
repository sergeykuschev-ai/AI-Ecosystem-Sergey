'use strict';
const DAYS = { понедельникам:1, вторникам:2, средам:3, четвергам:4, пятницам:5, субботам:6, воскресеньям:7 };
function matchesRecurringRequest(message) {
  if (typeof message !== 'string' || /^(?:как|почему|можно|что|надо ли)(?![\p{L}\p{N}])/iu.test(message) || /[?？\n«»]/u.test(message)) return false;
  return /^(?:покажи повторяющиеся дела|отмени повтор\s+|(?:артур[, ]+)?(?:(?:напоминай|напомни)\s+|создай повтор\s+)?[^\n]+\s+(?:каждый день|ежедневно|по (?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)))/iu.test(message);
}
function parseRecurringRequest(message) {
  if (/^покажи повторяющиеся дела\s*$/iu.test(message)) return {operation:'list'};
  const cancel = message.match(/^отмени повтор\s+(.+)$/iu);
  if (cancel) return {operation:'cancel',title:cancel[1].trim()};
  const match = message.replace(/^артур[, ]+/iu,'').replace(/^(?:напоминай|напомни|создай повтор)\s+/iu,'').match(/^(.+?)\s+(каждый день|ежедневно|по .+?)\s+в\s+([01]?\d|2[0-3]):([0-5]\d)\s*$/iu);
  if (!match || /^(?:как|почему|можно|надо ли|что)\b/iu.test(message)) return {clarification:'Напиши: «Напоминай английский каждый день в 20:00» или «Спортзал по понедельникам, средам и пятницам в 18:00».'};
  let weekdays = [1,2,3,4,5,6,7];
  if (/^по /iu.test(match[2])) {
    const names=match[2].slice(3).toLocaleLowerCase('ru-RU').split(/\s*(?:,|\s+и\s+)\s*/u);
    if (names.some(name=>!DAYS[name])) return {clarification:'Укажи дни недели полностью и одно точное время.'};
    weekdays=[...new Set(names.map(name=>DAYS[name]))].sort();
  }
  return {operation:'create',title:match[1].trim(),weekdays,localTime:match[3].padStart(2,'0')+':'+match[4]};
}
module.exports={matchesRecurringRequest,parseRecurringRequest};
