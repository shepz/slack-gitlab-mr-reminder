exports.isWipMr = mr => {
  if (!mr || !mr.title) return false; // Prevents errors if mr is undefined or title is missing

  if (mr.work_in_progress) return true; // Exclude Draft MRs

  const title = mr.title.toLowerCase().trim();
  if (title.startsWith('[wip]') || title.startsWith('wip:')) return true;

  return false;
};
