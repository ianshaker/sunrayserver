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

module.exports = { resolveAssigneeIds };
