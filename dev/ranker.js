// The ranking the extension's background does, for the test pages: ss/ß jobs
// go to the fine-tuned eszett model, everything else to the general model under
// the same confidence rule (rank.js).
import { score, eszett } from '../llm.js';

export async function rank(jobs) {
  const picks = [];
  for (const j of jobs) {
    if (j.type === 'eszett') { picks.push(await eszett(j.text, j.offsets)); continue; }
    picks.push(globalThis.HD_PICK(await score(j.texts), j));
  }
  return picks;
}
