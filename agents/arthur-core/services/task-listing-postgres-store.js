'use strict';

const { PostgresArthurStore, mapCommon } = require('./postgres-store');

class TaskListingPostgresStore extends PostgresArthurStore {
  async listTasks(ownerId, filter = {}) {
    const clauses = ['p.external_id=$1'];
    const values = [ownerId];
    const add = (sql, value) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };

    if (!filter.includeCompleted) clauses.push("t.status NOT IN ('done','cancelled')");
    if (filter.status) add('t.status=?', filter.status);
    if (filter.domain) add('t.domain=?', filter.domain);
    if (filter.dueBefore) add('t.due_at<=?', filter.dueBefore);
    if (filter.dueAfter) add('t.due_at>=?', filter.dueAfter);

    values.push(filter.limit || 50);
    const limitRef = `$${values.length}`;
    const result = await this.client.query(
      `SELECT t.*, p.external_id AS owner_id
       FROM arthur_tasks t
       JOIN arthur_profiles p ON p.id=t.owner_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.due_at NULLS LAST, t.priority DESC, t.created_at ASC
       LIMIT ${limitRef}`,
      values
    );
    return result.rows.map(mapCommon);
  }
}

module.exports = { TaskListingPostgresStore };