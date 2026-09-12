// The same choice rule the extension applies: the model only overrules the
// rules' default when it is clearly better, otherwise the default stands.
globalThis.HD_PICK = (scores, job) => {
  const best = scores.indexOf(Math.max(...scores));
  const def = job.def ?? 0;
  return best !== def && scores[best] - scores[def] < (job.conf ?? 0) ? def : best;
};
