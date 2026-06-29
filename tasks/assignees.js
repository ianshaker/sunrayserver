/** UUID исполнителей: assignees[] или legacy assigned_to. */
function resolveAssigneeIds(task) {
  const ids = [];
  if (Array.isArray(task.assignees) && task.assignees.length) {
    ids.push(...task.assignees);
  } else if (task.assigned_to) {
    ids.push(task.assigned_to);
  }
  return [...new Set(ids.filter(Boolean))];
}

/** Кто имеет право действовать по задаче: исполнители + автор + контролёры. */
function resolveAuthorizedUserIds(task) {
  const ids = [...resolveAssigneeIds(task)];
  if (task.assigned_by) ids.push(task.assigned_by);
  if (Array.isArray(task.controllers)) ids.push(...task.controllers);
  return [...new Set(ids.filter(Boolean))];
}

module.exports = { resolveAssigneeIds, resolveAuthorizedUserIds };
