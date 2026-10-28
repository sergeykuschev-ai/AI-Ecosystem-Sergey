'use strict';
function reminderKeyboard(task) {
  const version = Date.parse(task.updatedAt);
  if (!/^[0-9a-f-]{36}$/iu.test(task.id) || !Number.isFinite(version)) return undefined;
  return {inline_keyboard:[[['Выполнено','done'],['Через 30 минут','snooze'],['Отменить напоминание','cancel']].map(([text,action])=>({text,callback_data:`pa:${action[0]}:${task.id}:${version.toString(36)}`}))]};
}
function parsePersonalCallback(data) {
  const match=typeof data==='string' && data.match(/^pa:([dsc]):([0-9a-f-]{36}):([0-9a-z]+)$/iu);
  if (!match) return null;
  const version=parseInt(match[3],36);
  if (!Number.isSafeInteger(version) || !Number.isFinite(new Date(version).getTime())) return null;
  return {id:match[2],action:{d:'done',s:'snooze',c:'cancel'}[match[1]],expectedUpdatedAt:new Date(version).toISOString()};
}
module.exports={reminderKeyboard,parsePersonalCallback};
